import type { UIMessage } from 'ai'
import {
  extractMessageTextFromParts,
  extractToolPartsFromParts,
  getMessageParts,
} from '../ai/message-parts'

export function asUIMessageArray(value: unknown): UIMessage[] {
  return Array.isArray(value) ? (value as UIMessage[]) : []
}

export function cloneUIMessage(message: UIMessage): UIMessage {
  try {
    if (typeof structuredClone === 'function') {
      return structuredClone(message)
    }
  } catch {
    // fallback below
  }

  return JSON.parse(JSON.stringify(message)) as UIMessage
}

export function upsertAssistantMessage(
  messages: UIMessage[],
  assistantMessage: UIMessage
): UIMessage[] {
  if (messages.length === 0) {
    return [assistantMessage]
  }

  let existingIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.id === assistantMessage.id) {
      existingIndex = index
      break
    }
  }

  if (existingIndex >= 0) {
    return messages.map((message, index) => (index === existingIndex ? assistantMessage : message))
  }

  return [...messages, assistantMessage]
}

export function getTrailingAssistantMessage(messages: UIMessage[]): UIMessage | null {
  if (messages.length === 0) return null
  const last = messages[messages.length - 1]
  return last?.role === 'assistant' ? last : null
}

export function extractMessageText(message: UIMessage): string {
  return extractMessageTextFromParts(getMessageParts(message))
}

export function extractToolParts(message: UIMessage): Record<string, unknown>[] {
  return extractToolPartsFromParts(getMessageParts(message))
}
