export interface AssistantMessageSegment {
  kind: 'text' | 'think'
  text: string
}

const THINK_TAG_PATTERN = /<think>([\s\S]*?)<\/think>/gi

export function splitAssistantMessage(text: string): AssistantMessageSegment[] {
  const segments: AssistantMessageSegment[] = []
  let lastIndex = 0

  for (const match of text.matchAll(THINK_TAG_PATTERN)) {
    const [fullMatch, thinkText] = match
    const startIndex = match.index ?? 0

    if (startIndex > lastIndex) {
      segments.push({ kind: 'text', text: text.slice(lastIndex, startIndex) })
    }

    if (thinkText.length > 0) {
      segments.push({ kind: 'think', text: thinkText })
    }

    lastIndex = startIndex + fullMatch.length
  }

  if (lastIndex < text.length) {
    segments.push({ kind: 'text', text: text.slice(lastIndex) })
  }

  if (segments.length === 0) {
    return [{ kind: 'text', text }]
  }

  return segments
}
