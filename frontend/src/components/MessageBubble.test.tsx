// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MessageBubble } from './MessageBubble'

describe('MessageBubble', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders think content collapsed by default and toggles it on click', async () => {
    const user = userEvent.setup()

    render(
      <MessageBubble
        message={{
          id: 'assistant-1',
          role: 'assistant',
          text: 'Answer<think>private chain of thought</think>',
          timestamp: 0,
        }}
      />,
    )

    expect(screen.getByText('Answer')).toBeTruthy()

    const toggle = screen.getByRole('button', { name: 'Show think block 1' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('private chain of thought')).toBeNull()

    await user.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('private chain of thought')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Hide think block 1' }))

    expect(screen.queryByText('private chain of thought')).toBeNull()
  })

  it('preserves visible assistant text ordering around think blocks', async () => {
    const user = userEvent.setup()

    render(
      <MessageBubble
        message={{
          id: 'assistant-2',
          role: 'assistant',
          text: 'Alpha <think>hidden</think> Omega',
          timestamp: 0,
        }}
      />,
    )

    const toggle = screen.getByRole('button', { name: 'Show think block 1' })
    const bubble = toggle.closest('[data-message-role="assistant"]')

    expect(bubble?.textContent).toContain('LLM')
    expect(bubble?.textContent).toContain('Alpha ')
    expect(bubble?.textContent).toContain('Show think')
    expect(bubble?.textContent).toContain(' Omega')

    await user.click(toggle)
    expect(bubble?.textContent).toContain('hidden')
  })

  it('renders open-ended think content inside the expandable block', async () => {
    const user = userEvent.setup()

    render(
      <MessageBubble
        message={{
          id: 'assistant-3',
          role: 'assistant',
          text: 'Lead-in<think>unfinished reasoning',
          timestamp: 0,
        }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Show think block 1' }))

    expect(screen.getByText('unfinished reasoning')).toBeTruthy()
  })
})
