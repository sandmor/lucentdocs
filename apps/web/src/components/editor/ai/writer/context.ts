import type { EditorView } from 'prosemirror-view'
import type { InlineZoneSession } from '@lucentdocs/shared'

export function getDocumentContext(
  view: EditorView,
  pos: number
): { contextBefore: string; contextAfter?: string } {
  const docEnd = view.state.doc.content.size

  const contextBefore = view.state.doc.textBetween(0, pos, '\n\n', '\n')

  if (pos >= docEnd) {
    return { contextBefore }
  }

  const contextAfter = view.state.doc.textBetween(pos, docEnd, '\n\n', '\n')
  return { contextBefore, contextAfter }
}

export function getPromptContextForRange(
  view: EditorView,
  from: number,
  to: number
): { contextBefore: string; contextAfter?: string } {
  const docEnd = view.state.doc.content.size
  const safeFrom = Math.max(0, Math.min(from, docEnd))
  const safeTo = Math.max(safeFrom, Math.min(to, docEnd))

  const contextBefore = view.state.doc.textBetween(0, safeFrom, '\n\n', '\n')
  if (safeTo >= docEnd) {
    return { contextBefore }
  }

  const contextAfter = view.state.doc.textBetween(safeTo, docEnd, '\n\n', '\n')
  return { contextBefore, contextAfter }
}

export function serializeInlineConversation(session: InlineZoneSession | null | undefined): string {
  if (!session?.messages || session.messages.length === 0) {
    return ''
  }

  return session.messages
    .map((message) => {
      const role = message.role === 'user' ? 'User' : 'Assistant'
      const text = message.text?.trim() ?? ''
      if (!text) return ''
      return `${role}: ${text}`
    })
    .filter((entry) => entry.length > 0)
    .join('\n')
}
