import type { UIMessage } from 'ai'
import {
  extractMessageTextFromParts,
  extractToolPartsFromParts,
  getMessageParts,
} from '../ai/message-parts'

export function asUIMessageArray(value: unknown): UIMessage[] {
  return Array.isArray(value) ? (value as UIMessage[]) : []
}

export function upsertAssistantMessage(messages: UIMessage[], assistantMessage: UIMessage): UIMessage[] {
  if (messages.length === 0) {
    return [assistantMessage]
  }

  const existingIndex = messages.findIndex((message) => message.id === assistantMessage.id)
  if (existingIndex >= 0) {
    return messages.map((message, index) => (index === existingIndex ? assistantMessage : message))
  }

  const last = messages[messages.length - 1]
  if (last?.role === 'assistant') {
    return [...messages.slice(0, -1), assistantMessage]
  }

  return [...messages, assistantMessage]
}

export function extractMessageText(message: UIMessage): string {
  return extractMessageTextFromParts(getMessageParts(message))
}

export function extractToolParts(message: UIMessage): Record<string, unknown>[] {
  return extractToolPartsFromParts(getMessageParts(message))
}
