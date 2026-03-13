// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { RefObject } from 'react'
import { useAudioStream } from './useAudioStream'
import type { ChatAction } from '@/store/chatReducer'

const START_EVENT = JSON.stringify({ type: 'start', sample_rate: 16000, encoding: 'pcm_int16' })
const STOP_EVENT = JSON.stringify({ type: 'stop' })

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

function createConnectableNode() {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
}

function createMockAudioContext() {
  const source = createConnectableNode()
  const analyser = {
    ...createConnectableNode(),
    fftSize: 0,
    smoothingTimeConstant: 0,
  }
  const gain = {
    ...createConnectableNode(),
    gain: { value: 1 },
  }

  return {
    state: 'running',
    audioWorklet: {
      addModule: vi.fn().mockResolvedValue(undefined),
    },
    destination: {},
    createMediaStreamSource: vi.fn(() => source),
    createAnalyser: vi.fn(() => analyser),
    createGain: vi.fn(() => gain),
    close: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
  }
}

describe('useAudioStream', () => {
  let audioContextMock: ReturnType<typeof createMockAudioContext>

  beforeEach(() => {
    audioContextMock = createMockAudioContext()

    vi.stubGlobal(
      'WebSocket',
      class {
        static CONNECTING = 0
        static OPEN = 1
        static CLOSING = 2
        static CLOSED = 3
      } as unknown as typeof WebSocket,
    )

    vi.stubGlobal(
      'AudioContext',
      vi.fn(() => audioContextMock) as unknown as typeof AudioContext,
    )

    vi.stubGlobal(
      'AudioWorkletNode',
      vi.fn(
        () =>
          ({
            ...createConnectableNode(),
            port: {
              onmessage: null,
              close: vi.fn(),
            },
          }) as unknown as AudioWorkletNode,
      ) as unknown as typeof AudioWorkletNode,
    )

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-audio-worklet'),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('ignores duplicate start requests while microphone startup is already in flight', async () => {
    const mediaStream = {
      getTracks: vi.fn(() => [{ stop: vi.fn() }]),
    } as unknown as MediaStream
    const getUserMediaDeferred = createDeferred<MediaStream>()

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(() => getUserMediaDeferred.promise),
      },
    })

    const sendSpy = vi.fn()
    const dispatch = vi.fn<(action: ChatAction) => void>()
    const wsRef = {
      current: {
        readyState: WebSocket.OPEN,
        send: sendSpy,
      },
    } as unknown as RefObject<WebSocket | null>

    const { result } = renderHook(() => useAudioStream(wsRef, dispatch))

    let startPromise!: Promise<void>
    act(() => {
      startPromise = result.current.startRecording()
      void result.current.startRecording()
    })

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'MIC_REQUESTING')).toHaveLength(1)
    expect(result.current.captureState).toBe('starting')

    getUserMediaDeferred.resolve(mediaStream)
    await act(async () => {
      await startPromise
    })

    await waitFor(() => expect(result.current.captureState).toBe('recording'))
    expect(sendSpy).toHaveBeenCalledWith(START_EVENT)
    expect(sendSpy.mock.calls.filter(([payload]) => payload === START_EVENT)).toHaveLength(1)
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'RECORD_START')).toHaveLength(1)
  })

  it('cancels an in-flight microphone request without sending duplicate start side effects', async () => {
    const trackStopSpy = vi.fn()
    const mediaStream = {
      getTracks: vi.fn(() => [{ stop: trackStopSpy }]),
    } as unknown as MediaStream
    const getUserMediaDeferred = createDeferred<MediaStream>()

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(() => getUserMediaDeferred.promise),
      },
    })

    const sendSpy = vi.fn()
    const dispatch = vi.fn<(action: ChatAction) => void>()
    const wsRef = {
      current: {
        readyState: WebSocket.OPEN,
        send: sendSpy,
      },
    } as unknown as RefObject<WebSocket | null>

    const { result } = renderHook(() => useAudioStream(wsRef, dispatch))

    let startPromise!: Promise<void>
    act(() => {
      startPromise = result.current.startRecording()
    })

    expect(result.current.captureState).toBe('starting')

    act(() => {
      result.current.stopRecording()
    })

    expect(result.current.captureState).toBe('idle')
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'MIC_CANCELLED')).toHaveLength(1)

    getUserMediaDeferred.resolve(mediaStream)
    await act(async () => {
      await startPromise
    })

    expect(trackStopSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy).not.toHaveBeenCalled()
    expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual(['MIC_REQUESTING', 'MIC_CANCELLED'])
  })

  it('sends a single stop event even if stop is triggered more than once', async () => {
    const mediaStream = {
      getTracks: vi.fn(() => [{ stop: vi.fn() }]),
    } as unknown as MediaStream

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mediaStream),
      },
    })

    const sendSpy = vi.fn()
    const dispatch = vi.fn<(action: ChatAction) => void>()
    const wsRef = {
      current: {
        readyState: WebSocket.OPEN,
        send: sendSpy,
      },
    } as unknown as RefObject<WebSocket | null>

    const { result } = renderHook(() => useAudioStream(wsRef, dispatch))

    await act(async () => {
      await result.current.startRecording()
    })

    await waitFor(() => expect(result.current.captureState).toBe('recording'))

    act(() => {
      result.current.stopRecording()
      result.current.stopRecording()
    })

    expect(sendSpy.mock.calls.filter(([payload]) => payload === START_EVENT)).toHaveLength(1)
    expect(sendSpy.mock.calls.filter(([payload]) => payload === STOP_EVENT)).toHaveLength(1)
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'RECORD_STOP')).toHaveLength(1)
    expect(result.current.captureState).toBe('idle')
  })
})
