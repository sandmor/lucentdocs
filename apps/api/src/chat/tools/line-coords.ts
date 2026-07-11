import { renderDocumentContentToMarkdown } from '../../core/services/documentContent.js'
import { parseDocumentNode } from '../../core/services/documentContent.js'

export function selectionRangeToLineRange(
  documentContent: string,
  selectionFrom: number | null,
  selectionTo: number | null,
  renderedMarkdown?: string
): { start_line: number; end_line: number } | null {
  if (selectionFrom === null || selectionTo === null) return null

  const documentNode = parseDocumentNode(documentContent)
  if (!documentNode) return null

  const markdown = renderedMarkdown ?? renderDocumentContentToMarkdown(documentContent)
  const lines = markdown.length > 0 ? markdown.split('\n') : ['']
  const selectedText = documentNode.textBetween(selectionFrom, selectionTo, '\n\n', '\n').trim()
  if (!selectedText) {
    const ratio = selectionFrom / Math.max(1, documentNode.content.size)
    const approximateLine = Math.max(1, Math.min(lines.length, Math.ceil(ratio * lines.length)))
    return { start_line: approximateLine, end_line: approximateLine }
  }

  const selectedLines = selectedText.split('\n').map((line) => line.trim()).filter(Boolean)
  const anchor = selectedLines[0]
  if (!anchor) return null

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes(anchor)) continue
    const endLine = Math.min(lines.length, index + Math.max(1, selectedLines.length))
    return { start_line: index + 1, end_line: endLine }
  }

  return null
}

export function distanceToRelevanceScore(distance: number): number {
  return Number((1 / (1 + Math.max(0, distance))).toFixed(4))
}
