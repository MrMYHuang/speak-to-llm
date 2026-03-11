import { useEffect, useRef } from 'react'
import type { Message } from '@/store/chatReducer'
import { MessageBubble } from './MessageBubble'

export interface ChatThreadProps {
  messages: Message[]
}

export function ChatThread({ messages }: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <section
      className="flex-1 overflow-y-auto px-4 py-4"
      aria-label="Chat messages"
      aria-live="polite"
    >
      {messages.length === 0 ? (
        <p
          className="mt-12 text-center text-xs tracking-widest text-cp-muted"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          AWAITING TRANSMISSION
        </p>
      ) : (
        messages.map((msg, i) => <MessageBubble key={i} message={msg} />)
      )}
      <div ref={bottomRef} />
    </section>
  )
}
