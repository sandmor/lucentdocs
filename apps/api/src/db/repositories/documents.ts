import { nanoid } from 'nanoid'
import * as Y from 'yjs'
import {
  isJsonObject,
  isValidId,
  type Document,
  type JsonObject,
  createDefaultContent,
  parseContent,
} from '@plotline/shared'
import * as dalDocs from '../dal/documents.js'
import * as dalVersionSnapshots from '../dal/versionSnapshots.js'
import { getDb } from '../client.js'
import { withTransaction } from '../transaction.js'
import {
  getDocumentContent as getYjsContent,
  createSnapshot as createYjsSnapshot,
  evictLiveDocument,
  replaceDocument as replaceYjsDocument,
} from '../../yjs/server.js'

export interface DocumentWithContent extends Document {
  content: string
}

export interface VersionSnapshot {
  id: string
  documentId: string
  createdAt: number
}

function parseJsonObjectContent(value: string): JsonObject | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return isJsonObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function createDocument(
  title: string,
  content?: string,
  type: string = 'manuscript'
): Promise<DocumentWithContent> {
  const now = Date.now()
  const id = nanoid()
  const docContent = content ?? createDefaultContent()

  const doc: Document = {
    id,
    title,
    type,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  }

  const { prosemirrorJSONToYDoc } = await import('y-prosemirror')
  const { schema } = await import('@plotline/shared')

  const parsed = parseContent(docContent)
  const ydoc = prosemirrorJSONToYDoc(schema, parsed.doc)
  const blob = Y.encodeStateAsUpdate(ydoc)
  ydoc.destroy()
  const buffer = Buffer.from(blob)

  return withTransaction(async () => {
    await dalDocs.insert(doc)
    const db = await getDb()
    await db.run('INSERT INTO yjs_documents (name, data) VALUES (?, ?)', [id, buffer])
    return { ...doc, content: docContent }
  })
}

export async function getDocument(id: string): Promise<Document | null> {
  if (!isValidId(id)) return null
  return (await dalDocs.findById(id)) ?? null
}

export async function getDocumentWithContent(id: string): Promise<DocumentWithContent | null> {
  if (!isValidId(id)) return null

  const doc = await dalDocs.findById(id)
  if (!doc) return null

  const content = await getDocumentContent(id)
  return { ...doc, content }
}

export async function getDocumentContent(id: string): Promise<string> {
  const yjsContent = await getYjsContent(id)
  return yjsContent ?? createDefaultContent()
}

export async function getDocumentsWithContent(
  documentIds: string[]
): Promise<Map<string, DocumentWithContent>> {
  const result = new Map<string, DocumentWithContent>()

  if (documentIds.length === 0) return result

  const docs = await dalDocs.findByIds(documentIds)
  if (docs.length === 0) return result

  const hydrated = await Promise.all(
    docs.map(async (doc) => {
      const content = await getDocumentContent(doc.id)
      return { ...doc, content }
    })
  )

  for (const doc of hydrated) {
    result.set(doc.id, doc)
  }

  return result
}

export async function updateDocument(
  id: string,
  data: {
    title?: string
    metadata?: JsonObject | null
  }
): Promise<DocumentWithContent | null> {
  if (!isValidId(id)) return null

  const doc = await dalDocs.findById(id)
  if (!doc) return null

  const now = Date.now()

  await dalDocs.update(id, {
    title: data.title,
    metadata: data.metadata,
    updatedAt: now,
  })

  const content = await getDocumentContent(id)

  return {
    ...doc,
    title: data.title ?? doc.title,
    metadata: data.metadata === undefined ? doc.metadata : data.metadata,
    updatedAt: now,
    content,
  }
}

export async function getVersionHistory(id: string): Promise<VersionSnapshot[]> {
  if (!isValidId(id)) return []

  const rows = await dalVersionSnapshots.findMetadataByDocumentId(id)
  return rows.map((row) => ({
    id: row.id,
    documentId: row.documentId,
    createdAt: row.createdAt,
  }))
}

export async function createVersionSnapshot(id: string): Promise<VersionSnapshot | null> {
  if (!isValidId(id)) return null

  const doc = await dalDocs.findById(id)
  if (!doc) return null

  const created = await createYjsSnapshot(id)
  if (!created) return null

  return {
    id: created.id,
    documentId: created.documentId,
    createdAt: created.createdAt,
  }
}

export async function restoreToSnapshot(
  documentId: string,
  snapshotId: string
): Promise<DocumentWithContent | null> {
  if (!isValidId(documentId)) return null
  if (!isValidId(snapshotId)) return null

  const doc = await dalDocs.findById(documentId)
  if (!doc) return null

  const snapshot = await dalVersionSnapshots.findById(snapshotId)
  if (!snapshot || snapshot.documentId !== documentId) return null

  const content = parseJsonObjectContent(snapshot.content)
  if (!content) return null

  await replaceYjsDocument(documentId, content)

  const now = Date.now()
  await dalDocs.update(documentId, { updatedAt: now })

  const normalizedContent = await getDocumentContent(documentId)

  return {
    ...doc,
    updatedAt: now,
    content: normalizedContent,
  }
}

export async function deleteDocument(id: string): Promise<boolean> {
  if (!isValidId(id)) return false

  const doc = await dalDocs.findById(id)
  if (!doc) return false

  await withTransaction(async () => {
    await dalDocs.deleteById(id)
    const db = await getDb()
    await db.run('DELETE FROM yjs_documents WHERE name = ?', [id])
  })
  evictLiveDocument(id)

  return true
}
