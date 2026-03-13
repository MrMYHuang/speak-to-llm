// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChatAction } from '@/store/chatReducer'
import type { AudioCaptureState } from '@/hooks/useAudioStream'

const startSpy = vi.fn()
const stopSpy = vi.fn()
let wsDispatch: ((action: ChatAction) => void) | null = null

function triggerWsError() {
  wsDispatch?.({ type: 'WS_ERROR', error: 'WebSocket connection failed' })
}

vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: (_url: string, dispatch: (action: ChatAction) => void) => {
    wsDispatch = dispatch

    return {
      wsRef: { current: null },
      wsStatus: 'open',
    }
  },
}))

vi.mock('@/hooks/useAudioStream', async () => {
  const React = await import('react')

  return {
    useAudioStream: (_wsRef: unknown, dispatch: (action: { type: string }) => void) => {
      const [captureState, setCaptureState] = React.useState<AudioCaptureState>('idle')

      return {
        startRecording: async () => {
          startSpy()
          setCaptureState('recording')
          dispatch({ type: 'MIC_REQUESTING' })
          dispatch({ type: 'RECORD_START' })
        },
        stopRecording: () => {
          stopSpy()
          setCaptureState('idle')
          dispatch({ type: 'RECORD_STOP' })
        },
        captureState,
        analyserRef: React.createRef<AnalyserNode | null>(),
      }
    },
  }
})

import App from './App'

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })

  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => null),
  })
})

describe('App toggle speak control', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    startSpy.mockReset()
    stopSpy.mockReset()
    wsDispatch = null
  })

  it('toggles from start to stop on pointer clicks without duplicate side effects', async () => {
    const user = userEvent.setup()

    render(<App />)

    expect(screen.queryByTestId('waveform-bar')).toBeNull()

    const button = screen.getByRole('button', { name: 'Start recording' })

    await user.click(button)
    expect(startSpy).toHaveBeenCalledTimes(1)
    expect(stopSpy).not.toHaveBeenCalled()
    expect(screen.getByTestId('waveform-bar')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop recording' }).getAttribute('aria-pressed')).toBe(
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(startSpy).toHaveBeenCalledTimes(1)
    expect(stopSpy).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('waveform-bar')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Processing — please wait' }).getAttribute('aria-pressed'),
    ).toBe('false')
    expect(screen.getByRole('status').textContent).toContain('PROCESSING…')
  })

  it('toggles with keyboard activation for Enter and Space', async () => {
    const user = userEvent.setup()

    render(<App />)

    const button = screen.getByRole('button', { name: 'Start recording' })
    button.focus()

    await user.keyboard('{Enter}')
    expect(startSpy).toHaveBeenCalledTimes(1)
    expect(stopSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Stop recording' }).getAttribute('aria-pressed')).toBe(
      'true',
    )

    const stopButton = screen.getByRole('button', { name: 'Stop recording' })
    stopButton.focus()

    await user.keyboard(' ')
    expect(startSpy).toHaveBeenCalledTimes(1)
    expect(stopSpy).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('button', { name: 'Processing — please wait' }).getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('toggles with an unfocused global Space shortcut and prevents scrolling only when handled', () => {
    render(<App />)

    const handledStart = fireEvent.keyDown(document.body, {
      key: ' ',
      code: 'Space',
      bubbles: true,
      cancelable: true,
    })

    expect(handledStart).toBe(false)
    expect(startSpy).toHaveBeenCalledTimes(1)
    expect(stopSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Stop recording' }).getAttribute('aria-pressed')).toBe(
      'true',
    )

    const handledStop = fireEvent.keyDown(document.body, {
      key: ' ',
      code: 'Space',
      bubbles: true,
      cancelable: true,
    })

    expect(handledStop).toBe(false)
    expect(startSpy).toHaveBeenCalledTimes(1)
    expect(stopSpy).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('button', { name: 'Processing — please wait' }).getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('ignores the global Space shortcut inside editable or interactive targets', () => {
    render(<App />)

    const contentEditableRegion = document.createElement('div')
    contentEditableRegion.setAttribute('contenteditable', 'true')

    const editableTargets = [
      Object.assign(document.createElement('input'), { type: 'text' }),
      document.createElement('textarea'),
      document.createElement('select'),
      contentEditableRegion,
    ]

    for (const target of editableTargets) {
      document.body.appendChild(target)

      const event = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
      })

      target.dispatchEvent(event)
    }

    const link = Object.assign(document.createElement('a'), { href: '#' })
    document.body.appendChild(link)
    link.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
      }),
    )

    expect(startSpy).not.toHaveBeenCalled()
    expect(stopSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Start recording' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it('stops an active capture even after the reducer enters the error phase', async () => {
    const user = userEvent.setup()

    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Start recording' }))
    expect(startSpy).toHaveBeenCalledTimes(1)

    triggerWsError()

    const button = screen.getByRole('button', { name: 'Stop recording' })
    expect(button.getAttribute('aria-pressed')).toBe('true')

    await user.click(button)

    expect(startSpy).toHaveBeenCalledTimes(1)
    expect(stopSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Start recording' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })
})
