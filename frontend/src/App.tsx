import { useReducer } from 'react'
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

export default function App() {
  const [state, dispatch] = useReducer(chatReducer, initialState)

  const { wsRef, wsStatus } = useWebSocket(WS_URL, dispatch)
  const { startRecording, stopRecording, analyserRef } = useAudioStream(wsRef, dispatch)

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
        phase={state.phase}
        transcript={state.transcript}
        onMicDown={startRecording}
        onMicUp={stopRecording}
        analyserRef={analyserRef}
      />
    </div>
  )
}
