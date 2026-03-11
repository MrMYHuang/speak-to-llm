import type { Phase } from '@/store/chatReducer'

interface Config {
  label: string
  ariaLabel: string
  classes: string
  disabled: boolean
}

const PHASE_CONFIG: Record<Phase, Config> = {
  idle: {
    label: '⏺',
    ariaLabel: 'Hold to speak',
    classes: 'border-neon-cyan text-neon-cyan cp-glow-cyan hover:opacity-80',
    disabled: false,
  },
  'requesting-mic': {
    label: '⏺',
    ariaLabel: 'Requesting microphone access',
    classes: 'border-neon-pink text-neon-pink animate-pulse',
    disabled: true,
  },
  recording: {
    label: '⏹',
    ariaLabel: 'Recording — release to send',
    classes: 'border-neon-pink text-neon-pink cp-glow-pink animate-pulse',
    disabled: false,
  },
  processing: {
    label: '⏳',
    ariaLabel: 'Processing — please wait',
    classes: 'border-cp-muted text-cp-muted opacity-50',
    disabled: true,
  },
  responding: {
    label: '⏺',
    ariaLabel: 'Hold to speak',
    classes: 'border-neon-cyan text-neon-cyan cp-glow-cyan hover:opacity-80',
    disabled: false,
  },
  error: {
    label: '⏺',
    ariaLabel: 'Hold to speak',
    classes: 'border-neon-cyan text-neon-cyan cp-glow-cyan hover:opacity-80',
    disabled: false,
  },
}

export interface MicButtonProps {
  phase: Phase
  onPressStart: () => void
  onPressEnd: () => void
}

export function MicButton({ phase, onPressStart, onPressEnd }: MicButtonProps) {
  const { label, ariaLabel, classes, disabled } = PHASE_CONFIG[phase]

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return
    if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
      e.preventDefault()
      onPressStart()
    }
  }

  function handleKeyUp(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault()
      onPressEnd()
    }
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={phase === 'recording'}
      disabled={disabled}
      className={[
        'h-16 w-16 rounded-full border-2 text-2xl',
        'transition-all duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        'select-none',
        classes,
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
      onPointerDown={() => !disabled && onPressStart()}
      onPointerUp={() => !disabled && onPressEnd()}
      onPointerLeave={() => phase === 'recording' && onPressEnd()}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      {label}
    </button>
  )
}
