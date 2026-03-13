import { useState } from 'react'
import type { Message } from '@/store/chatReducer'
import { splitAssistantMessage } from '@/utils/assistantMessage'

export interface MessageBubbleProps {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const assistantSegments = isUser ? [] : splitAssistantMessage(message.text)
  const [expandedThinkSegments, setExpandedThinkSegments] = useState<Set<number>>(new Set())

  function toggleThinkSegment(index: number) {
    setExpandedThinkSegments((currentSegments) => {
      const nextSegments = new Set(currentSegments)

      if (nextSegments.has(index)) {
        nextSegments.delete(index)
      } else {
        nextSegments.add(index)
      }

      return nextSegments
    })
  }

  let thinkSegmentNumber = 0

  return (
    <div className={`mb-3 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        data-message-role={message.role}
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
          : assistantSegments.map((segment, index) => {
              if (segment.kind === 'text') {
                return <span key={`${message.id}-${index}`}>{segment.text}</span>
              }

              thinkSegmentNumber += 1
              const isExpanded = expandedThinkSegments.has(index)
              const thinkBlockId = `${message.id}-think-${index}`
              const toggleLabel = `${isExpanded ? 'Hide' : 'Show'} think block ${thinkSegmentNumber}`

              return (
                <div key={`${message.id}-${index}`} className="cp-think-block">
                  <button
                    type="button"
                    className="cp-think-toggle"
                    aria-expanded={isExpanded}
                    aria-controls={thinkBlockId}
                    aria-label={toggleLabel}
                    onClick={() => toggleThinkSegment(index)}
                  >
                    <span aria-hidden="true">{isExpanded ? '▼' : '▶'}</span>
                    <span>{isExpanded ? 'Hide think' : 'Show think'}</span>
                  </button>
                  {isExpanded ? (
                    <div id={thinkBlockId} className="cp-think-content">
                      {segment.text}
                    </div>
                  ) : null}
                </div>
              )
            })}
      </div>
    </div>
  )
}
