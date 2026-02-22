import { nanoid } from 'nanoid'
import * as Y from 'yjs'
import {
  isJsonObject,
  isValidId,
  directoryPathFromSentinel,
  isDirectorySentinelPath,
  isPathInsideDirectory,
  normalizeDocumentPath,
  pathHasSentinelSegment,
  pathSegments,
  toDirectorySentinelPath,
  type Document,
  type JsonObject,
  createDefaultContent,
  parseContent,
} from '@plotline/shared'
import * as dalDocs from '../dal/documents.js'
import * as dalProjectDocs from '../dal/projectDocuments.js'
import * as dalProjects from '../dal/projects.js'
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

async function isSoleDocumentForProject(projectId: string, documentId: string): Promise<boolean> {
  const soleProjectId = await dalProjectDocs.findSoleProjectIdByDocumentId(documentId)
  return soleProjectId === projectId
}

async function getProjectScopedDocument(
  projectId: string,
  documentId: string
): Promise<Document | null> {
  if (!isValidId(projectId) || !isValidId(documentId)) return null
  if (!(await isSoleDocumentForProject(projectId, documentId))) return null

  const doc = await dalDocs.findById(documentId)
  if (!doc) return null
  if (isDirectorySentinelPath(doc.title)) return null
  return doc
}

function listVisibleDocuments(docs: Document[]): Document[] {
  return docs.filter((doc) => !isDirectorySentinelPath(normalizeDocumentPath(doc.title)))
}

function getDefaultDocumentIdFromMetadata(metadata: JsonObject | null): string | null {
  if (!metadata) return null
  const value = metadata['default_document']
  return typeof value === 'string' && isValidId(value) ? value : null
}

async function setProjectDefaultDocument(projectId: string, documentId: string): Promise<void> {
  const project = await dalProjects.findById(projectId)
  if (!project) return
  const currentDefault = getDefaultDocumentIdFromMetadata(project.metadata)
  if (currentDefault === documentId) return

  const nextMetadata: JsonObject = {
    ...(project.metadata ?? {}),
    default_document: documentId,
  }
  await dalProjects.update(projectId, {
    metadata: nextMetadata,
    updatedAt: Date.now(),
  })
}

function hasAncestorFileConflict(paths: string[]): boolean {
  const normalized = paths.map((path) => normalizeDocumentPath(path)).filter((path) => path.length > 0)
  const filePaths = new Set(normalized.filter((path) => !isDirectorySentinelPath(path)))

  for (const path of normalized) {
    const segments = pathSegments(path)
    for (let index = 1; index < segments.length; index++) {
      const ancestor = segments.slice(0, index).join('/')
      if (filePaths.has(ancestor)) {
        return true
      }
    }
  }

  return false
}

function hasPathCollision(paths: string[]): boolean {
  const normalized = paths.map((path) => normalizeDocumentPath(path)).filter((path) => path.length > 0)
  return new Set(normalized).size !== normalized.length
}

function nextDefaultDocumentPath(existingPaths: string[]): string {
  for (let index = 1; index <= 10000; index++) {
    const candidate = index === 1 ? 'untitled.md' : `untitled-${index}.md`
    const finalPaths = [...existingPaths, candidate]
    if (!hasPathCollision(finalPaths) && !hasAncestorFileConflict(finalPaths)) {
      return candidate
    }
  }

  throw new Error('Unable to allocate a default document path')
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

export async function listDocumentsForProject(projectId: string): Promise<Document[]> {
  if (!isValidId(projectId)) return []

  const ids = await dalProjectDocs.findSoleDocumentIdsByProjectId(projectId)
  if (ids.length === 0) return []

  const docs = await dalDocs.findByIds(ids)
  if (docs.length === 0) return []

  const byId = new Map(docs.map((doc) => [doc.id, doc]))
  return ids.flatMap((id) => {
    const doc = byId.get(id)
    return doc ? [doc] : []
  })
}

export async function createDocumentForProject(
  projectId: string,
  title: string,
  content?: string,
  type: string = 'manuscript'
): Promise<DocumentWithContent | null> {
  if (!isValidId(projectId)) return null
  const normalizedTitle = normalizeDocumentPath(title)
  if (!normalizedTitle) return null
  if (type === 'directory-sentinel') {
    if (!isDirectorySentinelPath(normalizedTitle)) return null
  } else {
    if (isDirectorySentinelPath(normalizedTitle)) return null
    if (pathHasSentinelSegment(normalizedTitle)) return null
  }

  return withTransaction(async () => {
    const project = await dalProjects.findById(projectId)
    if (!project) return null

    const docs = await listDocumentsForProject(projectId)
    const finalPaths = docs.map((doc) => normalizeDocumentPath(doc.title)).concat(normalizedTitle)
    if (hasPathCollision(finalPaths) || hasAncestorFileConflict(finalPaths)) {
      return null
    }

    const doc = await createDocument(normalizedTitle, content, type)
    await dalProjectDocs.insert({
      projectId,
      documentId: doc.id,
      addedAt: Date.now(),
    })
    return doc
  })
}

export async function getDocumentForProject(
  projectId: string,
  documentId: string
): Promise<DocumentWithContent | null> {
  const doc = await getProjectScopedDocument(projectId, documentId)
  if (!doc) return null
  return getDocumentWithContent(documentId)
}

export async function setDefaultDocumentForProject(
  projectId: string,
  documentId: string
): Promise<boolean> {
  const doc = await getProjectScopedDocument(projectId, documentId)
  if (!doc) return false

  await withTransaction(async () => {
    await setProjectDefaultDocument(projectId, documentId)
  })
  return true
}

export async function updateDocumentForProject(
  projectId: string,
  documentId: string,
  data: {
    title?: string
    metadata?: JsonObject | null
  }
): Promise<DocumentWithContent | null> {
  const existing = await getProjectScopedDocument(projectId, documentId)
  if (!existing) return null

  if (data.title === undefined) {
    return updateDocument(documentId, data)
  }

  const normalizedTitle = normalizeDocumentPath(data.title)
  if (!normalizedTitle) return null
  if (isDirectorySentinelPath(normalizedTitle)) return null
  if (pathHasSentinelSegment(normalizedTitle)) return null

  const docs = await listDocumentsForProject(projectId)
  const finalPaths = docs.map((doc) => {
    if (doc.id === documentId) return normalizedTitle
    return normalizeDocumentPath(doc.title)
  })
  if (hasPathCollision(finalPaths) || hasAncestorFileConflict(finalPaths)) {
    return null
  }

  return updateDocument(documentId, { ...data, title: normalizedTitle })
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

export async function getVersionHistoryForProject(
  projectId: string,
  documentId: string
): Promise<VersionSnapshot[]> {
  if (!(await getProjectScopedDocument(projectId, documentId))) return []
  return getVersionHistory(documentId)
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

export async function createVersionSnapshotForProject(
  projectId: string,
  documentId: string
): Promise<VersionSnapshot | null> {
  if (!(await getProjectScopedDocument(projectId, documentId))) return null
  return createVersionSnapshot(documentId)
}

export async function restoreToSnapshot(
  documentId: string,
  snapshotId: string,
  options: { evictLive?: boolean } = {}
): Promise<DocumentWithContent | null> {
  if (!isValidId(documentId)) return null
  if (!isValidId(snapshotId)) return null

  const doc = await dalDocs.findById(documentId)
  if (!doc) return null

  const snapshot = await dalVersionSnapshots.findCursorById(documentId, snapshotId)
  if (!snapshot) return null

  const content = parseJsonObjectContent(snapshot.content)
  if (!content) return null

  await dalVersionSnapshots.deleteSnapshotsAfterCursor(
    documentId,
    snapshot.createdAt,
    snapshot.rowId
  )
  await replaceYjsDocument(documentId, content, { evictLive: options.evictLive ?? true })

  const now = Date.now()
  await dalDocs.update(documentId, { updatedAt: now })

  return {
    ...doc,
    updatedAt: now,
    content: JSON.stringify(content),
  }
}

export async function restoreToSnapshotForProject(
  projectId: string,
  documentId: string,
  snapshotId: string,
  options: { evictLive?: boolean } = {}
): Promise<DocumentWithContent | null> {
  if (!(await getProjectScopedDocument(projectId, documentId))) return null
  return restoreToSnapshot(documentId, snapshotId, options)
}

export async function deleteDocument(
  id: string,
  options: { evictLive?: boolean } = {}
): Promise<boolean> {
  if (!isValidId(id)) return false

  const doc = await dalDocs.findById(id)
  if (!doc) return false

  await withTransaction(async () => {
    await dalDocs.deleteById(id)
    const db = await getDb()
    await db.run('DELETE FROM yjs_documents WHERE name = ?', [id])
  })
  if (options.evictLive ?? true) {
    evictLiveDocument(id)
  }

  return true
}

export async function deleteDocumentForProject(
  projectId: string,
  documentId: string
): Promise<boolean> {
  if (!(await getProjectScopedDocument(projectId, documentId))) return false
  return deleteDocument(documentId)
}

export async function moveDocumentForProject(
  projectId: string,
  documentId: string,
  destinationPath: string
): Promise<DocumentWithContent | null> {
  const sourceDoc = await getProjectScopedDocument(projectId, documentId)
  if (!sourceDoc) return null

  const normalizedDestinationPath = normalizeDocumentPath(destinationPath)
  if (!normalizedDestinationPath) return null
  if (isDirectorySentinelPath(normalizedDestinationPath)) return null
  if (pathHasSentinelSegment(normalizedDestinationPath)) return null

  const normalizedSourcePath = normalizeDocumentPath(sourceDoc.title)
  if (normalizedSourcePath === normalizedDestinationPath) {
    return getDocumentWithContent(documentId)
  }

  const docs = await listDocumentsForProject(projectId)
  const finalPaths = docs.map((doc) => {
    if (doc.id === documentId) return normalizedDestinationPath
    return normalizeDocumentPath(doc.title)
  })

  if (hasPathCollision(finalPaths) || hasAncestorFileConflict(finalPaths)) {
    return null
  }

  return updateDocument(documentId, { title: normalizedDestinationPath })
}

export async function moveDirectoryForProject(
  projectId: string,
  sourcePath: string,
  destinationPath: string
): Promise<{ movedDocumentIds: string[]; destinationPath: string } | null> {
  if (!isValidId(projectId)) return null

  const normalizedSourcePath = normalizeDocumentPath(sourcePath)
  const normalizedDestinationPath = normalizeDocumentPath(destinationPath)
  if (!normalizedSourcePath || !normalizedDestinationPath) return null
  if (pathHasSentinelSegment(normalizedSourcePath) || pathHasSentinelSegment(normalizedDestinationPath))
    return null
  if (normalizedSourcePath === normalizedDestinationPath) {
    return { movedDocumentIds: [], destinationPath: normalizedDestinationPath }
  }
  if (isPathInsideDirectory(normalizedDestinationPath, normalizedSourcePath)) return null

  const docs = await listDocumentsForProject(projectId)
  const hasSourceDirectory = docs.some((doc) => {
    const normalizedTitle = normalizeDocumentPath(doc.title)
    if (isDirectorySentinelPath(normalizedTitle)) {
      const directory = directoryPathFromSentinel(normalizedTitle)
      return directory === normalizedSourcePath
    }
    return normalizedTitle.startsWith(`${normalizedSourcePath}/`)
  })

  if (!hasSourceDirectory) return null

  const updates = new Map<string, string>()
  const movedDocumentIds: string[] = []

  for (const doc of docs) {
    const normalizedTitle = normalizeDocumentPath(doc.title)

    if (isDirectorySentinelPath(normalizedTitle)) {
      const directoryPath = directoryPathFromSentinel(normalizedTitle)
      if (!directoryPath) continue
      if (!isPathInsideDirectory(directoryPath, normalizedSourcePath)) continue

      const suffix =
        directoryPath === normalizedSourcePath
          ? ''
          : directoryPath.slice(normalizedSourcePath.length + 1)
      const remappedDirectory = suffix
        ? `${normalizedDestinationPath}/${suffix}`
        : normalizedDestinationPath
      updates.set(doc.id, toDirectorySentinelPath(remappedDirectory))
      movedDocumentIds.push(doc.id)
      continue
    }

    if (!isPathInsideDirectory(normalizedTitle, normalizedSourcePath)) continue

    const suffix =
      normalizedTitle === normalizedSourcePath
        ? ''
        : normalizedTitle.slice(normalizedSourcePath.length + 1)
    const remappedPath = suffix ? `${normalizedDestinationPath}/${suffix}` : normalizedDestinationPath
    updates.set(doc.id, normalizeDocumentPath(remappedPath))
    movedDocumentIds.push(doc.id)
  }

  if (updates.size === 0) return null

  const finalPaths = docs.map((doc) => updates.get(doc.id) ?? normalizeDocumentPath(doc.title))
  if (hasPathCollision(finalPaths) || hasAncestorFileConflict(finalPaths)) {
    return null
  }

  const updatedAt = Date.now()
  await withTransaction(async () => {
    for (const [docId, title] of updates) {
      await dalDocs.update(docId, { title, updatedAt })
    }
  })

  return { movedDocumentIds, destinationPath: normalizedDestinationPath }
}

export async function createDirectoryForProject(
  projectId: string,
  directoryPath: string
): Promise<DocumentWithContent | null> {
  if (!isValidId(projectId)) return null

  const normalizedDirectory = normalizeDocumentPath(directoryPath)
  if (!normalizedDirectory) return null
  if (pathHasSentinelSegment(normalizedDirectory)) return null

  const sentinelPath = toDirectorySentinelPath(normalizedDirectory)
  const docs = await listDocumentsForProject(projectId)

  const existingSentinel = docs.find(
    (doc) => normalizeDocumentPath(doc.title) === sentinelPath && isDirectorySentinelPath(doc.title)
  )
  if (existingSentinel) {
    return getDocumentWithContent(existingSentinel.id)
  }

  return createDocumentForProject(projectId, sentinelPath, undefined, 'directory-sentinel')
}

export async function deleteDirectoryForProject(
  projectId: string,
  directoryPath: string
): Promise<{ deletedDocumentIds: string[] } | null> {
  if (!isValidId(projectId)) return null

  const normalizedDirectory = normalizeDocumentPath(directoryPath)
  if (!normalizedDirectory) return null
  if (pathHasSentinelSegment(normalizedDirectory)) return null

  const docs = await listDocumentsForProject(projectId)
  const docsToDelete = docs.filter((doc) => {
    const normalizedTitle = normalizeDocumentPath(doc.title)
    if (isDirectorySentinelPath(normalizedTitle)) {
      const sentinelDirectory = directoryPathFromSentinel(normalizedTitle)
      if (!sentinelDirectory) return false
      return isPathInsideDirectory(sentinelDirectory, normalizedDirectory)
    }
    return isPathInsideDirectory(normalizedTitle, normalizedDirectory)
  })

  if (docsToDelete.length === 0) return null

  await withTransaction(async () => {
    const db = await getDb()
    for (const doc of docsToDelete) {
      await dalDocs.deleteById(doc.id)
      await db.run('DELETE FROM yjs_documents WHERE name = ?', [doc.id])
    }
  })

  for (const doc of docsToDelete) {
    evictLiveDocument(doc.id)
  }

  return { deletedDocumentIds: docsToDelete.map((doc) => doc.id) }
}

export async function openOrCreateDefaultDocumentForProject(
  projectId: string
): Promise<DocumentWithContent | null> {
  if (!isValidId(projectId)) return null

  const project = await dalProjects.findById(projectId)
  if (!project) return null

  const initialDocs = await listDocumentsForProject(projectId)
  const initialVisibleDocs = listVisibleDocuments(initialDocs)
  const metadataDefaultDocumentId = getDefaultDocumentIdFromMetadata(project.metadata)
  if (metadataDefaultDocumentId) {
    const preferred = initialVisibleDocs.find((doc) => doc.id === metadataDefaultDocumentId)
    if (preferred) {
      return getDocumentWithContent(preferred.id)
    }
  }
  if (initialVisibleDocs.length > 0) {
    const fallback = initialVisibleDocs[0]!
    await withTransaction(async () => {
      await setProjectDefaultDocument(projectId, fallback.id)
    })
    return getDocumentWithContent(fallback.id)
  }

  return withTransaction(async () => {
    const docs = await listDocumentsForProject(projectId)
    const visibleDocs = listVisibleDocuments(docs)
    if (visibleDocs.length > 0) {
      const fallback = visibleDocs[0]!
      await setProjectDefaultDocument(projectId, fallback.id)
      return getDocumentWithContent(fallback.id)
    }

    const existingPaths = docs.map((doc) => normalizeDocumentPath(doc.title))
    const title = nextDefaultDocumentPath(existingPaths)
    const created = await createDocumentForProject(projectId, title)
    if (!created) return null
    await setProjectDefaultDocument(projectId, created.id)
    return created
  })
}
