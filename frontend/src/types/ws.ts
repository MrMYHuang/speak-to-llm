/** Messages sent from the Python backend over the WebSocket text channel. */
export type ServerMessage =
  | { type: 'transcript'; text: string }
  | { type: 'llm_response'; text: string }
  | { type: 'status'; state: 'buffering' | 'transcribing' | 'thinking' | 'idle' }
  | { type: 'error'; message: string }

/** Messages sent from the browser to the backend over the WebSocket text channel.
 *  Binary frames (audio blobs) are sent separately without this wrapper. */
export type ClientMessage =
  | { type: 'start'; sample_rate?: number; encoding?: string }
  | { type: 'stop' }

/** Parse a raw WebSocket text payload into a typed ServerMessage.
 *  Returns null if the payload is malformed or the type is unrecognised. */
export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) {
      return null
    }
    const msg = parsed as Record<string, unknown>
    switch (msg['type']) {
      case 'transcript':
        return typeof msg['text'] === 'string' ? { type: 'transcript', text: msg['text'] } : null
      case 'llm_response':
        return typeof msg['text'] === 'string' ? { type: 'llm_response', text: msg['text'] } : null
      case 'status':
        return msg['state'] === 'buffering' ||
          msg['state'] === 'transcribing' ||
          msg['state'] === 'thinking' ||
          msg['state'] === 'idle'
          ? { type: 'status', state: msg['state'] as 'buffering' | 'transcribing' | 'thinking' | 'idle' }
          : null
      case 'error':
        return typeof msg['message'] === 'string' ? { type: 'error', message: msg['message'] } : null
      default:
        return null
    }
  } catch {
    return null
  }
}
