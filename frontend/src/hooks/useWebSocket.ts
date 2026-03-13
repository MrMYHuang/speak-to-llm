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
  const dispatchRef = useRef(dispatch)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCountRef = useRef(0)
  const connectionIdRef = useRef(0)
  const [wsStatus, setWsStatus] = useState<WsStatus>('closed')

  /**
   * Set to true when the component unmounts so that callbacks spawned by an
   * in-flight connection do not mutate state after cleanup.
   */
  const deadRef = useRef(false)

  useEffect(() => {
    dispatchRef.current = dispatch
  }, [dispatch])

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
        case 'connecting': dispatchRef.current({ type: 'WS_CONNECTING' }); break
        case 'open':       dispatchRef.current({ type: 'WS_OPEN' });       break
        case 'closed':     dispatchRef.current({ type: 'WS_CLOSED' });     break
        // 'error' is dispatched directly with a message below
      }
    }

    function connect() {
      if (deadRef.current) return
      clearRetry()
      setStatus('connecting')

      connectionIdRef.current += 1
      const connectionId = connectionIdRef.current
      console.info(`[ws:${connectionId}] connecting`, { wsUrl, retryCount: retryCountRef.current })

      const ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onopen = () => {
        if (deadRef.current) {
          console.warn(`[ws:${connectionId}] opened after cleanup; closing stale socket`)
          ws.close(1000, 'component cleaned up')
          return
        }
        retryCountRef.current = 0
        console.info(`[ws:${connectionId}] open`)
        setStatus('open')
      }

      ws.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data === 'string') {
          const msg = parseServerMessage(ev.data)
          if (msg !== null) {
            console.debug(`[ws:${connectionId}] message`, {
              type: msg.type,
              textLength: 'text' in msg ? msg.text.length : undefined,
              errorLength: 'message' in msg ? msg.message.length : undefined,
              rawLength: ev.data.length,
            })
            dispatchRef.current({ type: 'SERVER_MSG', msg })
          } else {
            console.warn(`[ws:${connectionId}] ignored unparseable message`, {
              rawLength: ev.data.length,
            })
          }
        }
      }

      ws.onerror = () => {
        // onerror is always followed by onclose; broadcast error state so
        // the UI can show feedback, then let onclose decide whether to retry.
        console.error(`[ws:${connectionId}] error event`)
        setWsStatus('error')
        dispatchRef.current({ type: 'WS_ERROR', error: 'WebSocket connection failed' })
      }

      ws.onclose = (ev: CloseEvent) => {
        if (wsRef.current === ws) {
          wsRef.current = null
        }
        if (deadRef.current) return

        console.warn(`[ws:${connectionId}] closed`, {
          code: ev.code,
          reason: ev.reason,
          wasClean: ev.wasClean,
          bufferedAmount: ws.bufferedAmount,
        })
        setStatus('closed')

        if (RECONNECT_CODES.has(ev.code)) {
          const delay = Math.min(BACKOFF_BASE_MS * 2 ** retryCountRef.current, BACKOFF_MAX_MS)
          retryCountRef.current += 1
          console.info(`[ws:${connectionId}] scheduling reconnect`, { delay })
          retryTimerRef.current = setTimeout(connect, delay)
        }
      }
    }

    connect()

    return () => {
      deadRef.current = true
      clearRetry()
      const ws = wsRef.current
      if (ws !== null) {
        console.info('[ws] cleanup closing socket', {
          readyState: ws.readyState,
          url: ws.url,
        })
        ws.close(1000, 'component cleanup')
      }
      wsRef.current = null
    }
  }, [wsUrl])

  return { wsRef, wsStatus }
}
