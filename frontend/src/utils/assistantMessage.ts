export interface AssistantMessageSegment {
  kind: 'text' | 'think'
  text: string
}

const THINK_OPEN_TAG_PATTERN = /<think>/i
const THINK_CLOSE_TAG_PATTERN = /<\/think>/i

export function splitAssistantMessage(text: string): AssistantMessageSegment[] {
  const segments: AssistantMessageSegment[] = []
  let currentIndex = 0

  while (currentIndex < text.length) {
    const remainingText = text.slice(currentIndex)
    const openTagMatch = remainingText.match(THINK_OPEN_TAG_PATTERN)

    if (!openTagMatch || openTagMatch.index == null) {
      segments.push({ kind: 'text', text: text.slice(currentIndex) })
      break
    }

    const openTagIndex = currentIndex + openTagMatch.index

    if (openTagIndex > currentIndex) {
      segments.push({ kind: 'text', text: text.slice(currentIndex, openTagIndex) })
    }

    const thinkStartIndex = openTagIndex + openTagMatch[0].length
    const thinkRemainder = text.slice(thinkStartIndex)
    const closeTagMatch = thinkRemainder.match(THINK_CLOSE_TAG_PATTERN)

    if (!closeTagMatch || closeTagMatch.index == null) {
      if (thinkRemainder.length > 0) {
        segments.push({ kind: 'think', text: thinkRemainder })
      }
      currentIndex = text.length
      break
    }

    const thinkEndIndex = thinkStartIndex + closeTagMatch.index
    const thinkText = text.slice(thinkStartIndex, thinkEndIndex)

    if (thinkText.length > 0) {
      segments.push({ kind: 'think', text: thinkText })
    }

    currentIndex = thinkEndIndex + closeTagMatch[0].length
  }

  if (segments.length === 0) {
    return [{ kind: 'text', text }]
  }

  return segments
}
