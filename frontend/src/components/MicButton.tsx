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
    ariaLabel: 'Start recording',
    classes: 'border-neon-cyan text-neon-cyan cp-glow-cyan hover:opacity-80',
    disabled: false,
  },
  'requesting-mic': {
    label: '⏹',
    ariaLabel: 'Cancel recording',
    classes: 'border-neon-pink text-neon-pink animate-pulse',
    disabled: false,
  },
  recording: {
    label: '⏹',
    ariaLabel: 'Stop recording',
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
    ariaLabel: 'Start recording',
    classes: 'border-neon-cyan text-neon-cyan cp-glow-cyan hover:opacity-80',
    disabled: false,
  },
  error: {
    label: '⏺',
    ariaLabel: 'Start recording',
    classes: 'border-neon-cyan text-neon-cyan cp-glow-cyan hover:opacity-80',
    disabled: false,
  },
}

export interface MicButtonProps {
  phase: Phase
  onToggle: () => void
}

export function MicButton({ phase, onToggle }: MicButtonProps) {
  const { label, ariaLabel, classes, disabled } = PHASE_CONFIG[phase]
  const isPressed = phase === 'requesting-mic' || phase === 'recording'

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={isPressed}
      disabled={disabled}
      className={[
        'h-16 w-16 rounded-full border-2 text-2xl',
        'transition-all duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        'select-none',
        classes,
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
      onClick={() => !disabled && onToggle()}
    >
      {label}
    </button>
  )
}
