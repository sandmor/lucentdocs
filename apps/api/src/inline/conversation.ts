import type { InlineChatMessage, InlineZoneSession } from '@lucentdocs/shared'

const INLINE_CONVERSATION_TAIL_LINES = 24

export interface SerializeInlineConversationOptions {
  /** Omit the trailing user turn; the current prompt is passed separately in the template. */
  excludeTrailingUser?: boolean
}

function formatInlineMessageLine(message: InlineChatMessage): string {
  const role = message.role === 'assistant' ? 'Assistant' : 'User'
  const text = message.text.trim()
  if (text) {
    return `${role}: ${text}`
  }

  if (message.role === 'assistant' && message.tools.length > 0) {
    const toolNames = message.tools.map((tool) => tool.toolName).join(', ')
    return `${role}: [used tools: ${toolNames}]`
  }

  return ''
}

export function serializeInlineConversation(
  session: InlineZoneSession,
  options: SerializeInlineConversationOptions = {}
): string {
  let messages = session.messages
  if (options.excludeTrailingUser && messages.length > 0) {
    const last = messages[messages.length - 1]
    if (last?.role === 'user') {
      messages = messages.slice(0, -1)
    }
  }

  if (messages.length === 0) {
    return ''
  }

  const lines = messages
    .map((message) => formatInlineMessageLine(message))
    .filter((line) => line.length > 0)

  return lines.slice(-INLINE_CONVERSATION_TAIL_LINES).join('\n')
}

/**
 * Keeps user turns from a failed generation while dropping assistant output
 * produced only during that run.
 */
export function sessionAfterInterruptedGeneration(
  generationSession: InlineZoneSession,
  baselineSession: InlineZoneSession
): InlineZoneSession {
  const baselineMessageIds = new Set(baselineSession.messages.map((message) => message.id))
  const messages = [...generationSession.messages]

  while (messages.length > 0) {
    const last = messages[messages.length - 1]
    if (last?.role === 'assistant' && !baselineMessageIds.has(last.id)) {
      messages.pop()
      continue
    }
    break
  }

  return {
    ...generationSession,
    messages,
  }
}
