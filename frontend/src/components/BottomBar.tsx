import type { RefObject } from 'react'
import type { Phase } from '@/store/chatReducer'
import { useWaveform } from '@/hooks/useWaveform'
import { MicButton } from './MicButton'
import { WaveformBar } from './WaveformBar'

export interface BottomBarProps {
  phase: Phase
  transcript: string
  onMicToggle: () => void
  analyserRef: RefObject<AnalyserNode | null>
}

export function BottomBar({ phase, transcript, onMicToggle, analyserRef }: BottomBarProps) {
  const { amplitudes } = useWaveform(analyserRef)
  const isRecording = phase === 'recording'

  return (
    <footer className="border-t border-border bg-surface px-4 pb-6 pt-3">
      {/* Live waveform visualiser */}
      {isRecording && (
        <div className="mb-3" data-testid="waveform-bar">
          <WaveformBar amplitudes={amplitudes} active />
        </div>
      )}

      {/* Live transcript preview */}
      {transcript && (
        <p
          className="mb-3 truncate text-center text-sm text-neon-cyan"
          aria-live="polite"
          aria-label="Live transcript preview"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          {transcript}
        </p>
      )}

      {/* Mic recording toggle */}
      <div className="flex justify-center">
        <MicButton phase={phase} onToggle={onMicToggle} />
      </div>
    </footer>
  )
}
