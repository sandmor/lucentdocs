import { markdownToProseMirrorDoc } from '@lucentdocs/shared'

export function toEditorContent(markdown: string): string {
  const parsed = markdownToProseMirrorDoc(markdown)
  if (!parsed.ok) {
    throw new Error('Failed to build test editor content.')
  }

  return JSON.stringify({ doc: parsed.value, aiDraft: null })
}
