import * as Y from 'yjs'
import { yDocToProsemirrorJSON } from 'y-prosemirror'
import {
  createDefaultContent,
  parseContent,
  proseMirrorDocToMarkdown,
  type Document,
} from '@lucentdocs/shared'
import type { RepositorySet } from '../core/ports/types.js'

function serializeDocumentBody(content: string): string {
  const parsed = parseContent(content)
  const markdownResult = proseMirrorDocToMarkdown(parsed.doc)
  if (markdownResult.ok) {
    return markdownResult.value.trim()
  }

  return ''
}

export async function readDocumentContentSnapshot(
  repos: RepositorySet,
  documentId: string
): Promise<string> {
  const yjsData = await repos.yjsDocuments.getLatest(documentId)
  if (!yjsData) return createDefaultContent()

  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, new Uint8Array(yjsData))
    return JSON.stringify(yDocToProsemirrorJSON(doc))
  } finally {
    doc.destroy()
  }
}

export async function buildDocumentEmbeddingText(
  repos: RepositorySet,
  document: Document
): Promise<string> {
  const snapshot = await readDocumentContentSnapshot(repos, document.id)
  const body = serializeDocumentBody(snapshot)
  const title = document.title.trim()

  return title ? `# ${title}\n\n${body}` : body
}
