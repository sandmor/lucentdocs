import type { InlineToolChip } from '@lucentdocs/shared'

export interface InlineSessionPreview {
  generationId: string
  assistantText: string
  tools: InlineToolChip[]
}

export function areInlineSessionPreviewsEqual(
  left: InlineSessionPreview | null,
  right: InlineSessionPreview | null
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  if (left.generationId !== right.generationId) return false
  if (left.assistantText !== right.assistantText) return false
  if (left.tools.length !== right.tools.length) return false

  for (let index = 0; index < left.tools.length; index += 1) {
    if (left.tools[index]?.toolName !== right.tools[index]?.toolName) return false
    if (left.tools[index]?.state !== right.tools[index]?.state) return false
  }

  return true
}
