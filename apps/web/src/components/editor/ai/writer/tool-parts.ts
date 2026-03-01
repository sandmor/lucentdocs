import { parseInlineZoneWriteAction, type InlineZoneWriteAction } from '@plotline/shared'
import type { ParsedInlineToolPart } from './types'

export function parseInlineZoneActionFromToolPart(
  part: Record<string, unknown>
): InlineZoneWriteAction | null {
  const output =
    typeof part.output === 'object' && part.output !== null && !Array.isArray(part.output)
      ? (part.output as Record<string, unknown>)
      : null
  if (!output) return null

  const applied =
    typeof output.applied === 'object' && output.applied !== null && !Array.isArray(output.applied)
      ? output.applied
      : output

  return parseInlineZoneWriteAction(applied)
}

export function parseInlineToolPart(part: Record<string, unknown>): ParsedInlineToolPart | null {
  const partType = typeof part.type === 'string' ? part.type : ''
  const toolName =
    partType === 'dynamic-tool'
      ? typeof part.toolName === 'string'
        ? part.toolName
        : null
      : partType.startsWith('tool-')
        ? partType.replace(/^tool-/, '')
        : null
  if (!toolName) return null

  const rawState = typeof part.state === 'string' ? part.state : 'unknown'
  const chipState: 'pending' | 'complete' = rawState === 'output-available' ? 'complete' : 'pending'
  const toolCallId = typeof part.toolCallId === 'string' ? part.toolCallId : toolName

  return {
    toolName,
    toolCallId,
    rawState,
    chipState,
  }
}
