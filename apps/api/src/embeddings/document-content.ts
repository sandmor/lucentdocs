import * as Y from 'yjs'
import { yDocToProsemirrorJSON } from 'y-prosemirror'
import { createDefaultContent, type Document } from '@lucentdocs/shared'
import type { RepositorySet } from '../core/ports/types.js'
import {
  buildDocumentEmbeddingProjection,
  type DocumentEmbeddingProjection,
} from './document-projection.js'

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

export async function buildDocumentEmbeddingProjectionSnapshot(
  repos: RepositorySet,
  document: Document
): Promise<DocumentEmbeddingProjection> {
  const snapshot = await readDocumentContentSnapshot(repos, document.id)
  return buildDocumentEmbeddingProjection(document, snapshot)
}

export async function buildDocumentEmbeddingText(
  repos: RepositorySet,
  document: Document
): Promise<string> {
  const projection = await buildDocumentEmbeddingProjectionSnapshot(repos, document)
  return projection.text
}
