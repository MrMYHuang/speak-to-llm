import { describe, expect, it } from 'vitest'

import { parseServerMessage } from './ws'

describe('parseServerMessage', () => {
  it('parses unicode transcript and llm response payloads', () => {
    expect(
      parseServerMessage(JSON.stringify({ type: 'transcript', text: '请把这段话翻译成英文。' })),
    ).toEqual({
      type: 'transcript',
      text: '请把这段话翻译成英文。',
    })

    expect(
      parseServerMessage(JSON.stringify({ type: 'llm_response', text: '好的，我现在开始翻译。' })),
    ).toEqual({
      type: 'llm_response',
      text: '好的，我现在开始翻译。',
    })
  })

  it('parses large unicode llm response payloads', () => {
    const largeReply = '这是一个很长的中文响应。'.repeat(800)

    expect(
      parseServerMessage(JSON.stringify({ type: 'llm_response', text: largeReply })),
    ).toEqual({
      type: 'llm_response',
      text: largeReply,
    })
  })
})
