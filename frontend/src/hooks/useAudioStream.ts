/**
 * useAudioStream — push-to-talk audio capture at 16 kHz mono.
 *
 * Protocol (matches backend expectation):
 *   1. JSON  { type: 'start', sample_rate: 16000, encoding: 'pcm_int16' }
 *   2. Binary ArrayBuffer frames of PCM Int16 little-endian samples
 *   3. JSON  { type: 'stop' }
 *
 * Implementation uses an AudioWorkletNode backed by an inline Blob URL so
 * that no separate bundled asset file is required.  The worklet converts
 * Float32 input to Int16 and transfers the ArrayBuffer zero-copy via
 * port.postMessage.
 *
 * Audio graph:
 *   MediaStreamSource ──► AudioWorkletNode ──► silentGain(0) ──► destination
 *                    └──► AnalyserNode     ──► silentGain(0)
 *
 * Both branches feed into a GainNode(0) so the graph is "live" (required for
 * AudioWorklet processing to fire) but no audio is audibly played back.
 *
 * Lifecycle dispatches:
 *   startRecording()  → MIC_REQUESTING (before getUserMedia)
 *                     → RECORD_START   (mic granted, graph live)
 *                     → MIC_ERROR      (on any failure, with friendly message)
 *   stopRecording()   → RECORD_STOP    (frames stop, stop event sent)
 *
 * `analyserRef` is a stable ref (not state) so that useWaveform can consume
 * it without triggering re-renders when the node is swapped.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch, RefObject } from 'react'
import type { ChatAction } from '@/store/chatReducer'

// ── Worklet processor source ──────────────────────────────────────────────────

const WORKLET_NAME = 'pcm-int16-processor'

/**
 * Inline AudioWorkletProcessor that converts Float32 microphone samples to
 * Int16 PCM and transfers each render quantum to the main thread.
 * Written as plain JS – TypeScript does not check this string.
 */
const WORKLET_SOURCE = /* js */ `
class PcmInt16Processor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0]
    if (ch && ch.length > 0) {
      const pcm = new Int16Array(ch.length)
      for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]))
        pcm[i] = (s < 0 ? s * 32768 : s * 32767) | 0
      }
      // Transfer the underlying buffer (zero-copy) to the main thread.
      this.port.postMessage(pcm.buffer, [pcm.buffer])
    }
    return true // keep alive
  }
}
registerProcessor('${WORKLET_NAME}', PcmInt16Processor)
`

// ── Audio protocol helpers ────────────────────────────────────────────────────

const START_EVENT = JSON.stringify({ type: 'start', sample_rate: 16000, encoding: 'pcm_int16' })
const STOP_EVENT = JSON.stringify({ type: 'stop' })

// ── Public interface ──────────────────────────────────────────────────────────

export interface AudioStreamHandle {
  /**
   * Request microphone access, build the audio graph, and send the start
   * event.  Dispatches MIC_REQUESTING before the permission prompt, then
   * RECORD_START on success or MIC_ERROR with a friendly message on failure.
   */
  startRecording: () => Promise<void>
  /** Disconnect the audio graph, stop all tracks, and send the stop event. */
  stopRecording: () => void
  /**
   * Ref to the live AnalyserNode while recording (null otherwise).
   * Pass to `useWaveform` for real-time amplitude visualisation.
   */
  analyserRef: RefObject<AnalyserNode | null>
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAudioStream(
  wsRef: RefObject<WebSocket | null>,
  dispatch: Dispatch<ChatAction>,
): AudioStreamHandle {
  const analyserRef = useRef<AnalyserNode | null>(null)

  // Refs hold mutable audio resources so that startRecording / stopRecording
  // closures always see the latest values without stale closure issues.
  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const workletRef = useRef<AudioWorkletNode | null>(null)

  // ── Send helper ─────────────────────────────────────────────────────────────

  const wsSend = useCallback((data: string | ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data)
    }
  }, [wsRef])

  // ── Cleanup helper ──────────────────────────────────────────────────────────

  const teardown = useCallback(() => {
    workletRef.current?.port.close()
    workletRef.current?.disconnect()
    workletRef.current = null

    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null

    // AudioContext.close() is async but we don't need to await it here.
    ctxRef.current?.close().catch(() => undefined)
    ctxRef.current = null

    analyserRef.current = null
  }, [])

  // ── startRecording ──────────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    // Idempotent: tear down any previous capture session first.
    teardown()

    // Signal the phase transition before the permission prompt so the UI can
    // show a "waiting for mic" state immediately.
    dispatch({ type: 'MIC_REQUESTING' })

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is not supported in this browser')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream

      const ctx = new AudioContext({ sampleRate: 16000 })
      ctxRef.current = ctx

      // Resume from suspended state (browser autoplay policy).
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }

      if (!ctx.audioWorklet) {
        teardown()
        throw new Error('AudioWorklet is not supported in this browser')
      }

      // Load worklet from an inline Blob URL (no separate bundled file needed).
      const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' })
      const blobUrl = URL.createObjectURL(blob)
      try {
        await ctx.audioWorklet.addModule(blobUrl)
      } finally {
        URL.revokeObjectURL(blobUrl)
      }

      // Build audio graph.
      const source = ctx.createMediaStreamSource(stream)

      const worklet = new AudioWorkletNode(ctx, WORKLET_NAME)
      workletRef.current = worklet
      worklet.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
        wsSend(ev.data)
      }

      const analyser = ctx.createAnalyser()
      analyser.fftSize = 128
      analyser.smoothingTimeConstant = 0.6
      analyserRef.current = analyser

      // A gain node at 0 acts as a silent sink so the graph is "live" but
      // nothing is audibly played back.
      const silentGain = ctx.createGain()
      silentGain.gain.value = 0
      silentGain.connect(ctx.destination)

      source.connect(worklet)
      worklet.connect(silentGain)

      source.connect(analyser)
      analyser.connect(silentGain)

      // Signal the backend that a new utterance is starting.
      wsSend(START_EVENT)

      // Mic is live — transition to recording phase.
      dispatch({ type: 'RECORD_START' })
    } catch (err) {
      teardown()
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Please allow access and try again.'
          : err instanceof DOMException && err.name === 'NotFoundError'
            ? 'No microphone was found. Please connect one and try again.'
            : err instanceof Error
              ? err.message
              : 'Could not start the microphone.'
      dispatch({ type: 'MIC_ERROR', error: message })
    }
  }, [teardown, dispatch, wsSend])

  const stopRecording = useCallback(() => {
    // Tell the backend the utterance has ended before releasing resources so
    // the stop frame is guaranteed to be sent over an open socket.
    wsSend(STOP_EVENT)
    teardown()
    dispatch({ type: 'RECORD_STOP' })
  }, [teardown, dispatch, wsSend])

  useEffect(() => {
    return () => {
      teardown()
    }
    // teardown is stable (wrapped in useCallback with no deps).
  }, [teardown])

  return { startRecording, stopRecording, analyserRef }
}
