import { useCallback, useEffect, useReducer } from 'react'
import { chatReducer, initialState } from '@/store/chatReducer'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useAudioStream } from '@/hooks/useAudioStream'
import { TopBar } from '@/components/TopBar'
import { ChatThread } from '@/components/ChatThread'
import { BottomBar } from '@/components/BottomBar'
import { StatusOverlay } from '@/components/StatusOverlay'

const WS_URL = import.meta.env.VITE_WS_URL ?? '/ws/audio'

// True only when running on a non-localhost origin without HTTPS.
// AudioWorklet and getUserMedia require a secure context.
const isInsecureRemote =
  !window.isSecureContext && location.hostname !== 'localhost'

function getEventTargetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target
  }

  if (target instanceof Node) {
    return target.parentElement
  }

  return null
}

function shouldIgnoreGlobalSpaceShortcut(target: EventTarget | null): boolean {
  let element = getEventTargetElement(target)

  while (element) {
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLButtonElement ||
      element instanceof HTMLAnchorElement ||
      (element instanceof HTMLElement && element.isContentEditable) ||
      element.getAttribute('contenteditable') === '' ||
      element.getAttribute('contenteditable') === 'true' ||
      element.getAttribute('contenteditable') === 'plaintext-only'
    ) {
      return true
    }

    element = element.parentElement
  }

  return false
}

export default function App() {
  const [state, dispatch] = useReducer(chatReducer, initialState)

  const { wsRef, wsStatus } = useWebSocket(WS_URL, dispatch)
  const { startRecording, stopRecording, captureState, analyserRef } = useAudioStream(wsRef, dispatch)

  const controlPhase =
    captureState === 'idle'
      ? state.phase
      : captureState === 'starting'
        ? 'requesting-mic'
        : 'recording'

  const handleMicToggle = useCallback(() => {
    if (captureState !== 'idle') {
      stopRecording()
      return true
    }

    switch (state.phase) {
      case 'idle':
      case 'responding':
      case 'error':
        void startRecording()
        return true
      case 'recording':
        stopRecording()
        return true
      default:
        return false
    }
  }, [captureState, state.phase, startRecording, stopRecording])

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return
      }

      if (event.repeat || event.defaultPrevented || shouldIgnoreGlobalSpaceShortcut(event.target)) {
        return
      }

      if (handleMicToggle()) {
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown)

    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown)
    }
  }, [handleMicToggle])

  return (
    <div className="flex h-full flex-col bg-bg text-cp-text">
      {/* Secure-context warning — shown only on non-HTTPS remote origins */}
      {isInsecureRemote && (
        <div
          className="border-b border-neon-pink bg-surface px-4 py-2 text-center text-xs tracking-widest text-neon-pink"
          role="alert"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          ⚠ MICROPHONE REQUIRES A SECURE CONTEXT — OPEN VIA HTTPS OR LOCALHOST
        </div>
      )}

      <TopBar wsStatus={wsStatus} />

      {/* Main content area — relative so StatusOverlay can overlay it */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <ChatThread messages={state.messages} />
        <StatusOverlay phase={state.phase} />
      </div>

      <BottomBar
        phase={controlPhase}
        transcript={state.transcript}
        onMicToggle={handleMicToggle}
        analyserRef={analyserRef}
      />
    </div>
  )
}
