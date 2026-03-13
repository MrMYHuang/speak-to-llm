/**
 * useAudioStream — toggle-driven audio capture at 16 kHz mono.
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

import { useCallback, useEffect, useRef, useState } from 'react'
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
  /** UI-facing capture state so controls can stop/cancel even if reducer phase drifts. */
  captureState: AudioCaptureState
  /**
   * Ref to the live AnalyserNode while recording (null otherwise).
   * Pass to `useWaveform` for real-time amplitude visualisation.
   */
  analyserRef: RefObject<AnalyserNode | null>
}

export type AudioCaptureState = 'idle' | 'starting' | 'recording'

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAudioStream(
  wsRef: RefObject<WebSocket | null>,
  dispatch: Dispatch<ChatAction>,
): AudioStreamHandle {
  const analyserRef = useRef<AnalyserNode | null>(null)
  const [captureState, setCaptureState] = useState<AudioCaptureState>('idle')

  // Refs hold mutable audio resources so that startRecording / stopRecording
  // closures always see the latest values without stale closure issues.
  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const workletRef = useRef<AudioWorkletNode | null>(null)
  const sessionIdRef = useRef(0)
  const isStartingRef = useRef(false)
  const isRecordingRef = useRef(false)

  // ── Send helper ─────────────────────────────────────────────────────────────

  const wsSend = useCallback((data: string | ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      if (typeof data === 'string') {
        console.debug('[audio] sending websocket event', data)
      }
      wsRef.current.send(data)
      return
    }

    console.warn('[audio] skipped websocket send because socket is not open', {
      readyState: wsRef.current?.readyState ?? 'missing',
      payloadType: typeof data === 'string' ? 'text' : 'binary',
    })
  }, [wsRef])

  // ── Cleanup helper ──────────────────────────────────────────────────────────

  const teardown = useCallback(() => {
    console.debug('[audio] tearing down audio graph')
    const worklet = workletRef.current
    if (worklet !== null) {
      worklet.port.onmessage = null
    }
    worklet?.port.close()
    worklet?.disconnect()
    workletRef.current = null

    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null

    // AudioContext.close() is async but we don't need to await it here.
    ctxRef.current?.close().catch(() => undefined)
    ctxRef.current = null

    analyserRef.current = null
    isStartingRef.current = false
    isRecordingRef.current = false
  }, [])

  // ── startRecording ──────────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    if (isStartingRef.current || isRecordingRef.current) {
      console.debug('[audio] ignored duplicate start request')
      return
    }

    // Signal the phase transition before the permission prompt so the UI can
    // show a "waiting for mic" state immediately.
    const sessionId = sessionIdRef.current + 1
    sessionIdRef.current = sessionId
    isStartingRef.current = true
    setCaptureState('starting')
    dispatch({ type: 'MIC_REQUESTING' })

    try {
      console.info('[audio] requesting microphone access')
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
      if (sessionId !== sessionIdRef.current) {
        stream.getTracks().forEach(track => track.stop())
        return
      }
      streamRef.current = stream

      const ctx = new AudioContext({ sampleRate: 16000 })
      if (sessionId !== sessionIdRef.current) {
        stream.getTracks().forEach(track => track.stop())
        void ctx.close().catch(() => undefined)
        return
      }
      ctxRef.current = ctx

      // Resume from suspended state (browser autoplay policy).
      if (ctx.state === 'suspended') {
        await ctx.resume()
        if (sessionId !== sessionIdRef.current) {
          teardown()
          return
        }
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
      if (sessionId !== sessionIdRef.current) {
        teardown()
        return
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
      console.info('[audio] recording started')
      isRecordingRef.current = true
      setCaptureState('recording')
      dispatch({ type: 'RECORD_START' })
    } catch (err) {
      setCaptureState('idle')
      teardown()
      if (sessionId === sessionIdRef.current) {
        const message =
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Microphone permission was denied. Please allow access and try again.'
            : err instanceof DOMException && err.name === 'NotFoundError'
              ? 'No microphone was found. Please connect one and try again.'
              : err instanceof Error
                ? err.message
                : 'Could not start the microphone.'
        console.error('[audio] failed to start recording', err)
        dispatch({ type: 'MIC_ERROR', error: message })
      }
    } finally {
      if (sessionId === sessionIdRef.current) {
        isStartingRef.current = false
      }
    }
  }, [teardown, dispatch, wsSend])

  const stopRecording = useCallback(() => {
    if (isStartingRef.current) {
      console.debug('[audio] cancelling microphone startup')
      sessionIdRef.current += 1
      isStartingRef.current = false
      setCaptureState('idle')
      teardown()
      dispatch({ type: 'MIC_CANCELLED' })
      return
    }

    if (!isRecordingRef.current) {
      console.debug('[audio] ignored duplicate stop request')
      return
    }

    // Tell the backend the utterance has ended before releasing resources so
    // the stop frame is guaranteed to be sent over an open socket.
    console.info('[audio] stopping recording')
    sessionIdRef.current += 1
    isRecordingRef.current = false
    setCaptureState('idle')
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

  return { startRecording, stopRecording, captureState, analyserRef }
}
