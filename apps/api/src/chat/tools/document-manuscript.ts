import { createHash } from 'node:crypto'
import { lucentExportMarkdownSerializer, schema } from '@lucentdocs/shared'
import type { Node as ProseMirrorNode } from 'prosemirror-model'

export interface ManuscriptSnapshot {
  path: string
  documentId: string
  plain: string
  hash: string
}

export function hashManuscriptText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function manuscriptLineAt(text: string, offset: number): number {
  if (offset <= 0) return 1
  const clamped = Math.min(offset, text.length)
  return text.slice(0, clamped).split('\n').length
}

export function serializeTopLevelBlock(node: ProseMirrorNode): string {
  const blockDoc = schema.nodes.doc.create(null, [node])
  return lucentExportMarkdownSerializer.serialize(blockDoc).trimEnd()
}

export function projectDocumentManuscript(doc: ProseMirrorNode): string {
  const exported = schema.nodes.doc.create(null, doc.content)
  return lucentExportMarkdownSerializer.serialize(exported).trimEnd()
}

export function snapshotFromManuscript(
  path: string,
  documentId: string,
  plain: string
): ManuscriptSnapshot {
  return {
    path,
    documentId,
    plain,
    hash: hashManuscriptText(plain),
  }
}
