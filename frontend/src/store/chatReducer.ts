/**
 * 6-phase state machine for the voice-LLM chat session.
 *
 * Phases
 * ──────
 * idle           – app mounted; WS may or may not be connected (see wsStatus)
 * requesting-mic – recording toggle pressed, getUserMedia in flight
 * recording      – mic granted, binary audio frames going out
 * processing     – recording stopped, waiting for transcript + LLM response
 * responding     – LLM response received and displayed
 * error          – recoverable error requiring user attention
 *
 * WS connection health is tracked separately in wsStatus so the phase can
 * remain 'idle' (or 'responding') while the socket reconnects in the background.
 *
 * Transitions are explicit: every action is handled in at least one phase.
 * Unknown (action, phase) pairs fall through to `return state` so the
 * reducer is always total.
 */

import type { ServerMessage } from '@/types/ws'

// ── Phase / WsStatus types ────────────────────────────────────────────────────

export type Phase =
  | 'idle'
  | 'requesting-mic'
  | 'recording'
  | 'processing'
  | 'responding'
  | 'error'

export type WsStatus = 'connecting' | 'open' | 'closed' | 'error'

// ── Domain types ──────────────────────────────────────────────────────────────

export interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp: number
}

// ── State ─────────────────────────────────────────────────────────────────────

export interface ChatState {
  phase: Phase
  wsStatus: WsStatus
  transcript: string
  messages: Message[]
  errorMessage: string | null
}

export const initialState: ChatState = {
  phase: 'idle',
  wsStatus: 'closed',
  transcript: '',
  messages: [],
  errorMessage: null,
}

// ── Actions ───────────────────────────────────────────────────────────────────

export type ChatAction =
  /** WS connection attempt started (including reconnect attempts). */
  | { type: 'WS_CONNECTING' }
  /** WS onopen fired — connection established. */
  | { type: 'WS_OPEN' }
  /** WS onclose fired. */
  | { type: 'WS_CLOSED' }
  /** WS onerror fired before close — surfaces a hard error to the UI. */
  | { type: 'WS_ERROR'; error: string }
  /** getUserMedia requested — before the browser permission prompt. */
  | { type: 'MIC_REQUESTING' }
  /** getUserMedia resolved — mic active, start sending frames. */
  | { type: 'RECORD_START' }
  /** User toggled recording off. */
  | { type: 'RECORD_STOP' }
  /** User cancelled microphone startup before recording began. */
  | { type: 'MIC_CANCELLED' }
  /** getUserMedia rejected or AudioWorklet unavailable. */
  | { type: 'MIC_ERROR'; error: string }
  /** Parsed JSON frame received from the backend. */
  | { type: 'SERVER_MSG'; msg: ServerMessage }
  /** User dismisses the error banner. */
  | { type: 'DISMISS_ERROR' }

// ── Reducer ───────────────────────────────────────────────────────────────────

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  const { phase } = state

  switch (action.type) {
    // WS lifecycle ────────────────────────────────────────────────────────────

    case 'WS_CONNECTING':
      return { ...state, wsStatus: 'connecting' }

    case 'WS_OPEN':
      return { ...state, wsStatus: 'open' }

    case 'WS_CLOSED':
      return { ...state, wsStatus: 'closed' }

    case 'WS_ERROR':
      return { ...state, wsStatus: 'error', phase: 'error', errorMessage: action.error }

    // Recording lifecycle ─────────────────────────────────────────────────────

    case 'MIC_REQUESTING':
      if (phase === 'idle' || phase === 'responding' || phase === 'error') {
        return { ...state, phase: 'requesting-mic', errorMessage: null }
      }
      return state

    case 'RECORD_START':
      if (phase === 'requesting-mic') {
        return { ...state, phase: 'recording', transcript: '' }
      }
      return state

    case 'RECORD_STOP':
      if (phase === 'recording') {
        return { ...state, phase: 'processing' }
      }
      return state

    case 'MIC_CANCELLED':
      if (phase === 'requesting-mic') {
        return { ...state, phase: 'idle' }
      }
      return state

    case 'MIC_ERROR':
      return { ...state, phase: 'error', errorMessage: action.error }

    // Server messages ─────────────────────────────────────────────────────────

    case 'SERVER_MSG': {
      const { msg } = action
      if (msg.type === 'transcript') {
        return {
          ...state,
          transcript: msg.text,
          messages: [
            ...state.messages,
            { id: crypto.randomUUID(), role: 'user', text: msg.text, timestamp: Date.now() },
          ],
        }
      }
      if (msg.type === 'llm_response') {
        return {
          ...state,
          phase: 'responding',
          messages: [
            ...state.messages,
            { id: crypto.randomUUID(), role: 'assistant', text: msg.text, timestamp: Date.now() },
          ],
        }
      }
      if (msg.type === 'status') {
        // Status hints do not change phase; UI can derive copy from phase.
        return state
      }
      if (msg.type === 'error') {
        return { ...state, phase: 'error', errorMessage: msg.message }
      }
      return state
    }

    // Error dismissal ─────────────────────────────────────────────────────────

    case 'DISMISS_ERROR':
      if (phase === 'error') {
        return { ...state, phase: 'idle', errorMessage: null }
      }
      return state

    default:
      return state
  }
}
