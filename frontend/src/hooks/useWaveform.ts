/**
 * useWaveform — real-time amplitude samples from an AnalyserNode ref.
 *
 * Reads byte time-domain data at the display frame rate (rAF) and returns
 * `{ amplitudes: Uint8Array }` of `BINS` values in the range [0, 255].
 * The animation loop runs continuously; when `analyserRef.current` is null
 * (not recording) the hook returns the stable silent array (all 128 = silence
 * for getByteTimeDomainData) and skips the analyser read.
 *
 * Using a ref (rather than state) for the analyser node means the RAF loop
 * is started exactly once per mount and picks up the live node on each tick
 * without needing a dependency re-subscribe.
 *
 * Usage:
 *   const { amplitudes } = useWaveform(analyserRef)   // Uint8Array(BINS)
 */

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

// Number of amplitude samples exposed to consumers.
export const WAVEFORM_BINS = 64

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWaveform(analyserRef: RefObject<AnalyserNode | null>): { amplitudes: Uint8Array } {
  const [amplitudes, setAmplitudes] = useState<Uint8Array>(() => new Uint8Array(WAVEFORM_BINS).fill(128))
  const rafRef = useRef<number>(0)

  // Track whether the last tick saw an active analyser. When it transitions
  // from active → inactive we reset amplitudes to the silence baseline.
  const wasActiveRef = useRef(false)

  useEffect(() => {
    function tick() {
      const analyser = analyserRef.current
      if (analyser !== null) {
        wasActiveRef.current = true
        // The analyser fftSize is set in useAudioStream (128), giving 128
        // byte samples. We average adjacent pairs into BINS = 64 values.
        const bufferSize = analyser.fftSize
        const readBuf = new Uint8Array(bufferSize)
        analyser.getByteTimeDomainData(readBuf)

        const pairsPerBin = Math.max(1, Math.floor(bufferSize / WAVEFORM_BINS))
        const out = new Uint8Array(WAVEFORM_BINS)
        for (let i = 0; i < WAVEFORM_BINS; i++) {
          let sum = 0
          for (let j = 0; j < pairsPerBin; j++) {
            sum += readBuf[i * pairsPerBin + j] ?? 128
          }
          out[i] = Math.round(sum / pairsPerBin)
        }
        setAmplitudes(out)
      } else if (wasActiveRef.current) {
        // Analyser just disappeared — reset to silence baseline once.
        wasActiveRef.current = false
        setAmplitudes(new Uint8Array(WAVEFORM_BINS).fill(128))
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
    // analyserRef is a stable object reference — no re-subscribe needed.
  }, [analyserRef])

  return { amplitudes }
}
