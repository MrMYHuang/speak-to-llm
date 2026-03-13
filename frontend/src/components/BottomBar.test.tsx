// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { BottomBar } from './BottomBar'

vi.mock('@/hooks/useWaveform', () => ({
  useWaveform: () => ({
    amplitudes: new Uint8Array([128, 128, 128, 128]),
  }),
}))

describe('BottomBar', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => null),
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the waveform while recording', () => {
    render(
      <BottomBar
        phase="recording"
        transcript=""
        onMicToggle={() => {}}
        analyserRef={createRef<AnalyserNode | null>()}
      />,
    )

    expect(screen.getByTestId('waveform-bar')).toBeTruthy()
  })

  it.each(['idle', 'requesting-mic', 'processing'] as const)(
    'hides the waveform when phase is %s',
    (phase) => {
      render(
        <BottomBar
          phase={phase}
          transcript=""
          onMicToggle={() => {}}
          analyserRef={createRef<AnalyserNode | null>()}
        />,
      )

      expect(screen.queryByTestId('waveform-bar')).toBeNull()
    },
  )
})
