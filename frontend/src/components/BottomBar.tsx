import type { RefObject } from 'react'
import type { Phase } from '@/store/chatReducer'
import { useWaveform } from '@/hooks/useWaveform'
import { MicButton } from './MicButton'
import { WaveformBar } from './WaveformBar'

export interface BottomBarProps {
  phase: Phase
  transcript: string
  onMicDown: () => void
  onMicUp: () => void
  analyserRef: RefObject<AnalyserNode | null>
}

export function BottomBar({ phase, transcript, onMicDown, onMicUp, analyserRef }: BottomBarProps) {
  const { amplitudes } = useWaveform(analyserRef)
  const isRecording = phase === 'recording'

  return (
    <footer className="border-t border-border bg-surface px-4 pb-6 pt-3">
      {/* Live waveform visualiser */}
      <div className="mb-3">
        <WaveformBar amplitudes={amplitudes} active={isRecording} />
      </div>

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

      {/* Mic push-to-talk */}
      <div className="flex justify-center">
        <MicButton phase={phase} onPressStart={onMicDown} onPressEnd={onMicUp} />
      </div>
    </footer>
  )
}
