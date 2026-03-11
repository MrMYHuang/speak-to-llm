/**
 * useWebSocket — manages the WebSocket connection lifecycle.
 *
 * - Connects on mount using the provided `wsUrl`.
 * - Dispatches WS_CONNECTING → WS_OPEN / WS_ERROR / WS_CLOSED.
 * - Auto-reconnects with exponential back-off (capped at 30 s) **only** for
 *   abnormal close codes 1006 (Abnormal Closure) and 1011 (Internal Error).
 *   All other close codes (including normal 1000/1001) do not auto-reconnect.
 * - Dispatches SERVER_MSG for every parseable text frame.
 * - Cleans up safely in React StrictMode (double-invoke) via `deadRef`.
 *
 * Returns `{ wsRef, wsStatus }`:
 *   - `wsRef`    – mutable ref to the live WebSocket (pass to useAudioStream)
 *   - `wsStatus` – reactive local status string for UI / hooks consumers
 */

import { useEffect, useRef, useState } from 'react'
import type { Dispatch, RefObject } from 'react'
import { parseServerMessage } from '@/types/ws'
import type { ChatAction, WsStatus } from '@/store/chatReducer'

// ── Constants ─────────────────────────────────────────────────────────────────

const BACKOFF_BASE_MS = 1_000
const BACKOFF_MAX_MS = 30_000

/** Close codes that warrant an automatic reconnect attempt. */
const RECONNECT_CODES = new Set([1006, 1011])

// ── Public interface ──────────────────────────────────────────────────────────

export interface WebSocketHandle {
  wsRef: RefObject<WebSocket | null>
  wsStatus: WsStatus
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWebSocket(
  wsUrl: string,
  dispatch: Dispatch<ChatAction>,
): WebSocketHandle {
  const wsRef = useRef<WebSocket | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCountRef = useRef(0)
  const [wsStatus, setWsStatus] = useState<WsStatus>('closed')

  /**
   * Set to true when the component unmounts so that callbacks spawned by an
   * in-flight connection do not mutate state after cleanup.
   */
  const deadRef = useRef(false)

  useEffect(() => {
    deadRef.current = false

    function clearRetry() {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
    }

    function setStatus(s: WsStatus) {
      setWsStatus(s)
      switch (s) {
        case 'connecting': dispatch({ type: 'WS_CONNECTING' }); break
        case 'open':       dispatch({ type: 'WS_OPEN' });       break
        case 'closed':     dispatch({ type: 'WS_CLOSED' });     break
        // 'error' is dispatched directly with a message below
      }
    }

    function connect() {
      if (deadRef.current) return
      clearRetry()
      setStatus('connecting')

      const ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onopen = () => {
        if (deadRef.current) { ws.close(); return }
        retryCountRef.current = 0
        setStatus('open')
      }

      ws.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data === 'string') {
          const msg = parseServerMessage(ev.data)
          if (msg !== null) dispatch({ type: 'SERVER_MSG', msg })
        }
      }

      ws.onerror = () => {
        // onerror is always followed by onclose; broadcast error state so
        // the UI can show feedback, then let onclose decide whether to retry.
        setWsStatus('error')
        dispatch({ type: 'WS_ERROR', error: 'WebSocket connection failed' })
      }

      ws.onclose = (ev: CloseEvent) => {
        wsRef.current = null
        if (deadRef.current) return

        setStatus('closed')

        if (RECONNECT_CODES.has(ev.code)) {
          const delay = Math.min(BACKOFF_BASE_MS * 2 ** retryCountRef.current, BACKOFF_MAX_MS)
          retryCountRef.current += 1
          retryTimerRef.current = setTimeout(connect, delay)
        }
      }
    }

    connect()

    return () => {
      deadRef.current = true
      clearRetry()
      wsRef.current?.close()
      wsRef.current = null
    }
    // wsUrl and dispatch are both stable across the component lifetime.
  }, [wsUrl, dispatch])

  return { wsRef, wsStatus }
}
