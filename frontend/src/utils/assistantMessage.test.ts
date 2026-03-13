import { describe, expect, it } from 'vitest'

import { splitAssistantMessage } from './assistantMessage'

describe('splitAssistantMessage', () => {
  it('returns plain text when there are no think tags', () => {
    expect(splitAssistantMessage('Hello there')).toEqual([
      { kind: 'text', text: 'Hello there' },
    ])
  })

  it('extracts think tag content without keeping the raw tags', () => {
    expect(splitAssistantMessage('Visible <think>internal reasoning</think> more')).toEqual([
      { kind: 'text', text: 'Visible ' },
      { kind: 'think', text: 'internal reasoning' },
      { kind: 'text', text: ' more' },
    ])
  })

  it('supports multiple think blocks', () => {
    expect(splitAssistantMessage('<think>a</think>b<think>c</think>')).toEqual([
      { kind: 'think', text: 'a' },
      { kind: 'text', text: 'b' },
      { kind: 'think', text: 'c' },
    ])
  })

  it('treats an open-ended think tag as a think segment through the end of the message', () => {
    expect(splitAssistantMessage('Visible<think>internal reasoning')).toEqual([
      { kind: 'text', text: 'Visible' },
      { kind: 'think', text: 'internal reasoning' },
    ])
  })

  it('keeps ordered text and think segments when closed and open-ended think tags are mixed', () => {
    expect(splitAssistantMessage('A<think>one</think>B<think>two')).toEqual([
      { kind: 'text', text: 'A' },
      { kind: 'think', text: 'one' },
      { kind: 'text', text: 'B' },
      { kind: 'think', text: 'two' },
    ])
  })
})
