import type { Phase } from '@/store/chatReducer'

interface OverlayConfig {
  text: string
  colorClass: string
}

const OVERLAY_CONFIG: Partial<Record<Phase, OverlayConfig>> = {
  'requesting-mic': { text: 'REQUESTING MIC ACCESS…', colorClass: 'text-neon-pink' },
  processing: { text: 'PROCESSING…', colorClass: 'text-neon-cyan' },
}

export interface StatusOverlayProps {
  phase: Phase
}

export function StatusOverlay({ phase }: StatusOverlayProps) {
  const config = OVERLAY_CONFIG[phase]
  if (!config) return null

  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-bg) 85%, transparent)' }}
      role="status"
      aria-live="polite"
    >
      <p
        className={`animate-pulse text-lg font-bold tracking-widest ${config.colorClass}`}
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {config.text}
      </p>
    </div>
  )
}
