import type { UIMessage } from 'ai'
import type { InlineToolChip, InlineZoneSession } from '@lucentdocs/shared'
import {
  extractMessageTextFromPartsRaw,
  extractToolPartsFromParts,
  getMessageParts,
} from '../ai/message-parts'
import type { InlineSessionPreview } from './inline-session-preview'

function toToolChipState(rawState: string): InlineToolChip['state'] {
  return rawState === 'output-available' ? 'complete' : 'pending'
}

export function extractInlineToolsFromMessage(message: UIMessage): InlineToolChip[] {
  const tools: InlineToolChip[] = []

  for (const part of extractToolPartsFromParts(getMessageParts(message))) {
    const partType = typeof part.type === 'string' ? part.type : ''
    const toolName =
      partType === 'dynamic-tool'
        ? typeof part.toolName === 'string'
          ? part.toolName
          : null
        : partType.startsWith('tool-')
          ? partType.replace(/^tool-/, '')
          : null
    if (!toolName) continue
    if (toolName === 'write_zone' || toolName === 'write_zone_choices') continue

    const rawState = typeof part.state === 'string' ? part.state : 'unknown'
    const nextState = toToolChipState(rawState)
    const existingIndex = tools.findIndex((tool) => tool.toolName === toolName)
    if (existingIndex >= 0) {
      tools[existingIndex] = { ...tools[existingIndex], state: nextState }
    } else {
      tools.push({ toolName, state: nextState })
    }
  }

  return tools
}

export function previewFromUIMessage(
  generationId: string,
  message: UIMessage
): InlineSessionPreview {
  return {
    generationId,
    assistantText: extractMessageTextFromPartsRaw(getMessageParts(message)),
    tools: extractInlineToolsFromMessage(message),
  }
}

export function getAssistantSeedMessage(session: InlineZoneSession | null): UIMessage | null {
  if (!session?.messages?.length) return null
  const latestAssistant = [...session.messages]
    .reverse()
    .find((message) => message.role === 'assistant')
  if (!latestAssistant) return null

  return {
    id: latestAssistant.id,
    role: 'assistant',
    parts: [{ type: 'text', text: latestAssistant.text }],
  }
}
