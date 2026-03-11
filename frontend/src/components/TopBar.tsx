import type { WsStatus } from '@/store/chatReducer'

interface StatusConfig {
  label: string
  colorClass: string
  glowStyle?: React.CSSProperties
}

const WS_STATUS_CONFIG: Record<WsStatus, StatusConfig> = {
  connecting: { label: 'CONNECTING', colorClass: 'text-neon-pink' },
  open: {
    label: 'ONLINE',
    colorClass: 'text-neon-green',
    glowStyle: { textShadow: 'var(--glow-green)' },
  },
  closed: { label: 'OFFLINE', colorClass: 'text-cp-muted' },
  error: {
    label: 'ERROR',
    colorClass: 'text-neon-pink',
    glowStyle: { textShadow: 'var(--glow-pink)' },
  },
}

export interface TopBarProps {
  wsStatus: WsStatus
}

export function TopBar({ wsStatus }: TopBarProps) {
  const { label, colorClass, glowStyle } = WS_STATUS_CONFIG[wsStatus]

  return (
    <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
      <h1
        className="text-xl font-bold tracking-widest text-neon-cyan cp-text-glow-cyan"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        SPEAK-TO-LLM
      </h1>
      <span
        className={`text-xs font-semibold tracking-widest ${colorClass}`}
        style={{ fontFamily: 'var(--font-display)', ...glowStyle }}
        aria-label={`WebSocket status: ${label}`}
      >
        ● {label}
      </span>
    </header>
  )
}
