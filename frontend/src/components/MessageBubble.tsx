import type { Message } from '@/store/chatReducer'

export interface MessageBubbleProps {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div className={`mb-3 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[75%] rounded border px-4 py-2 text-sm',
          isUser
            ? 'border-neon-cyan bg-surface text-neon-cyan cp-glow-cyan'
            : 'border-neon-pink bg-surface text-cp-text',
        ].join(' ')}
        style={{ fontFamily: 'var(--font-body)' }}
      >
        <span
          className={`mb-1 block text-xs font-semibold tracking-widest ${isUser ? 'text-neon-cyan' : 'text-neon-pink'}`}
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {isUser ? 'YOU' : 'LLM'}
        </span>
        {message.text}
      </div>
    </div>
  )
}
