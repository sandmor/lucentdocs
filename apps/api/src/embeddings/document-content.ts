import * as Y from 'yjs'
import { yDocToProsemirrorJSON } from 'y-prosemirror'
import { createDefaultContent } from '@lucentdocs/shared'
import type { RepositorySet } from '../core/ports/types.js'

/**
 * Reads the latest persisted Yjs snapshot and returns ProseMirror JSON content.
 */
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
