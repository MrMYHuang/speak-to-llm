import type { Message } from '@/store/chatReducer'
import { splitAssistantMessage } from '@/utils/assistantMessage'

export interface MessageBubbleProps {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const assistantSegments = isUser ? [] : splitAssistantMessage(message.text)

  return (
    <div className={`mb-3 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[75%] rounded border px-4 py-2 text-[20pt] leading-[1.35] whitespace-pre-wrap break-words',
          isUser
            ? 'border-neon-cyan bg-surface text-neon-cyan cp-glow-cyan'
            : 'border-neon-pink bg-surface text-neon-pink',
        ].join(' ')}
        style={{ fontFamily: 'var(--font-body)' }}
      >
        <span
          className={`mb-1 block text-xs font-semibold tracking-widest ${isUser ? 'text-neon-cyan' : 'text-neon-pink'}`}
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {isUser ? 'YOU' : 'LLM'}
        </span>
        {isUser
          ? message.text
          : assistantSegments.map((segment, index) => (
              <span
                key={`${message.id}-${index}`}
                className={segment.kind === 'think' ? 'text-neon-green cp-text-glow-green' : undefined}
              >
                {segment.text}
              </span>
            ))}
      </div>
    </div>
  )
}
