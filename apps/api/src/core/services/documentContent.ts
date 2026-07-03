import { parseContent, schema, lucentExportMarkdownSerializer } from '@lucentdocs/shared'
import { Node as ProseMirrorNode } from 'prosemirror-model'

export function parseDocumentNode(content: string): ProseMirrorNode | null {
  try {
    const parsed = parseContent(content)
    return ProseMirrorNode.fromJSON(schema, parsed.doc)
  } catch {
    return null
  }
}

export function renderDocumentContentToMarkdown(content: string): string {
  const documentNode = parseDocumentNode(content)
  if (!documentNode) return ''

  try {
    return lucentExportMarkdownSerializer.serialize(documentNode).trimEnd()
  } catch {
    return documentNode.textBetween(0, documentNode.content.size, '\n\n', '\n').trimEnd()
  }
}
