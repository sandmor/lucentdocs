import { nanoid } from 'nanoid'
import * as Y from 'yjs'
import {
  isValidId,
  type Document,
  type JsonObject,
  createDefaultContent,
  parseContent,
  markdownToProseMirrorDoc,
  normalizeDocumentPath,
  isDirectorySentinelPath,
  pathHasSentinelSegment,
  isPathInsideDirectory,
  directoryPathFromSentinel,
  toDirectorySentinelPath,
  isJsonObject,
} from '@lucentdocs/shared'
import { yDocToProsemirrorJSON, prosemirrorJSONToYDoc } from 'y-prosemirror'
import type { RepositorySet } from '../../core/ports/types.js'
import type { TransactionPort } from '../../core/ports/transaction.port.js'

export interface DocumentWithContent extends Document {
  content: string
}

export interface VersionSnapshot {
  id: string
  documentId: string
  createdAt: number
}

export type ImportDocumentErrorKind =
  | 'invalid_project_id'
  | 'invalid_path'
  | 'project_not_found'
  | 'markdown_parse_failed'

export interface ImportDocumentError {
  kind: ImportDocumentErrorKind
  cause?: unknown
}

export type ImportDocumentResult =
  | { ok: true; doc: DocumentWithContent }
  | { ok: false; error: ImportDocumentError }

export interface DocumentsService {
  getById(id: string): Promise<Document | null>
  getWithContent(id: string): Promise<DocumentWithContent | null>
  getContent(id: string): Promise<string>
  getWithContentByIds(documentIds: string[]): Promise<Map<string, DocumentWithContent>>
  listForProject(projectId: string): Promise<Document[]>

  create(title: string, content?: string, type?: string): Promise<DocumentWithContent>
  createForProject(
    projectId: string,
    title: string,
    content?: string,
    type?: string
  ): Promise<DocumentWithContent | null>
  update(
    id: string,
    data: { title?: string; metadata?: JsonObject | null }
  ): Promise<DocumentWithContent | null>
  updateForProject(
    projectId: string,
    documentId: string,
    data: { title?: string; metadata?: JsonObject | null }
  ): Promise<DocumentWithContent | null>
  delete(id: string): Promise<boolean>
  deleteForProject(projectId: string, documentId: string): Promise<boolean>

  setDefaultForProject(projectId: string, documentId: string): Promise<boolean>
  openOrCreateDefaultForProject(projectId: string): Promise<DocumentWithContent | null>

  moveForProject(
    projectId: string,
    documentId: string,
    destinationPath: string
  ): Promise<DocumentWithContent | null>
  moveDirectoryForProject(
    projectId: string,
    sourcePath: string,
    destinationPath: string
  ): Promise<{ movedDocumentIds: string[]; destinationPath: string } | null>
  createDirectoryForProject(
    projectId: string,
    directoryPath: string
  ): Promise<DocumentWithContent | null>
  deleteDirectoryForProject(
    projectId: string,
    directoryPath: string
  ): Promise<{ deletedDocumentIds: string[] } | null>

  getForProject(projectId: string, documentId: string): Promise<DocumentWithContent | null>

  importForProject(
    projectId: string,
    title: string,
    markdown: string
  ): Promise<ImportDocumentResult>

  getVersionHistory(id: string): Promise<VersionSnapshot[]>
  getVersionHistoryForProject(projectId: string, documentId: string): Promise<VersionSnapshot[]>
  createSnapshot(id: string): Promise<VersionSnapshot | null>
  createSnapshotForProject(projectId: string, documentId: string): Promise<VersionSnapshot | null>
  restoreToSnapshot(documentId: string, snapshotId: string): Promise<DocumentWithContent | null>
  restoreToSnapshotForProject(
    projectId: string,
    documentId: string,
    snapshotId: string
  ): Promise<DocumentWithContent | null>
}

function listVisibleDocuments(docs: Document[]): Document[] {
  return docs.filter((doc) => !isDirectorySentinelPath(normalizeDocumentPath(doc.title)))
}

function getDefaultDocumentIdFromMetadata(metadata: JsonObject | null): string | null {
  if (!metadata) return null
  const value = metadata['default_document']
  return typeof value === 'string' && isValidId(value) ? value : null
}

function hasAncestorFileConflict(paths: string[]): boolean {
  const normalized = paths.map(normalizeDocumentPath).filter((p) => p.length > 0)
  const filePaths = new Set(normalized.filter((p) => !isDirectorySentinelPath(p)))

  for (const path of normalized) {
    const segments = path.split('/')
    for (let i = 1; i < segments.length; i++) {
      const ancestor = segments.slice(0, i).join('/')
      if (filePaths.has(ancestor)) return true
    }
  }
  return false
}

function hasPathCollision(paths: string[]): boolean {
  const normalized = paths.map(normalizeDocumentPath).filter((p) => p.length > 0)
  return new Set(normalized).size !== normalized.length
}

function nextDefaultDocumentPath(existingPaths: string[]): string {
  for (let i = 1; i <= 10000; i++) {
    const candidate = i === 1 ? 'untitled.md' : `untitled-${i}.md`
    const finalPaths = [...existingPaths, candidate]
    if (!hasPathCollision(finalPaths) && !hasAncestorFileConflict(finalPaths)) {
      return candidate
    }
  }
  throw new Error('Unable to allocate a default document path')
}

function resolveUniqueImportPath(requestedPath: string, existingPaths: string[]): string {
  const normalized = normalizeDocumentPath(requestedPath)
  if (!normalized) return 'imported.md'

  const pathSet = new Set(existingPaths.map(normalizeDocumentPath))
  if (!pathSet.has(normalized) && !hasAncestorFileConflict([...existingPaths, normalized])) {
    return normalized
  }

  const lastDot = normalized.lastIndexOf('.')
  const base = lastDot > 0 ? normalized.slice(0, lastDot) : normalized
  const ext = lastDot > 0 ? normalized.slice(lastDot) : ''

  for (let i = 1; i <= 10000; i++) {
    const candidate = `${base}-${i}${ext}`
    if (!pathSet.has(candidate) && !hasAncestorFileConflict([...existingPaths, candidate])) {
      return candidate
    }
  }
  throw new Error('Unable to allocate a unique import path')
}

function parseJsonObjectContent(value: string): JsonObject | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return isJsonObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function isSoleDocumentForProject(
  repos: RepositorySet,
  projectId: string,
  documentId: string
): Promise<boolean> {
  const soleProjectId = await repos.projectDocuments.findSoleProjectIdByDocumentId(documentId)
  return soleProjectId === projectId
}

async function getProjectScopedDocument(
  repos: RepositorySet,
  projectId: string,
  documentId: string
): Promise<Document | null> {
  if (!isValidId(projectId) || !isValidId(documentId)) return null
  if (!(await isSoleDocumentForProject(repos, projectId, documentId))) return null

  const doc = await repos.documents.findById(documentId)
  if (!doc) return null
  if (isDirectorySentinelPath(doc.title)) return null
  return doc
}

export function createDocumentsService(
  repos: RepositorySet,
  transaction: TransactionPort
): DocumentsService {
  const getDocumentContent = async (id: string): Promise<string> => {
    const yjsData = await repos.yjsDocuments.getLatest(id)
    if (!yjsData) return createDefaultContent()

    const doc = new Y.Doc()
    Y.applyUpdate(doc, new Uint8Array(yjsData))
    const content = JSON.stringify(yDocToProsemirrorJSON(doc))
    doc.destroy()
    return content
  }

  const getDocumentWithContent = async (id: string): Promise<DocumentWithContent | null> => {
    if (!isValidId(id)) return null
    const doc = await repos.documents.findById(id)
    if (!doc) return null
    const content = await getDocumentContent(id)
    return { ...doc, content }
  }

  const createDocument = async (
    title: string,
    content?: string,
    type: string = 'manuscript'
  ): Promise<DocumentWithContent> => {
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

    const { schema } = await import('@lucentdocs/shared')
    const parsed = parseContent(docContent)
    const ydoc = prosemirrorJSONToYDoc(schema, parsed.doc)
    const blob = Y.encodeStateAsUpdate(ydoc)
    ydoc.destroy()
    const buffer = Buffer.from(blob)

    await transaction.run(async () => {
      await repos.documents.insert(doc)
      await repos.yjsDocuments.set(id, buffer)
    })

    return { ...doc, content: docContent }
  }

  const listDocumentsForProject = async (projectId: string): Promise<Document[]> => {
    if (!isValidId(projectId)) return []
    const ids = await repos.projectDocuments.findSoleDocumentIdsByProjectId(projectId)
    if (ids.length === 0) return []
    const docs = await repos.documents.findByIds(ids)
    const byId = new Map(docs.map((d: Document) => [d.id, d]))
    return ids.flatMap((id: string) => {
      const doc = byId.get(id)
      return doc ? [doc] : []
    })
  }

  const setProjectDefaultDocument = async (
    projectId: string,
    documentId: string
  ): Promise<void> => {
    const project = await repos.projects.findById(projectId)
    if (!project) return
    const currentDefault = getDefaultDocumentIdFromMetadata(project.metadata)
    if (currentDefault === documentId) return

    const nextMetadata: JsonObject = {
      ...(project.metadata ?? {}),
      default_document: documentId,
    }
    await repos.projects.update(projectId, {
      metadata: nextMetadata,
      updatedAt: Date.now(),
    })
  }

  return {
    async getById(id: string): Promise<Document | null> {
      if (!isValidId(id)) return null
      return (await repos.documents.findById(id)) ?? null
    },

    getWithContent: getDocumentWithContent,

    getContent: getDocumentContent,

    async getWithContentByIds(documentIds: string[]): Promise<Map<string, DocumentWithContent>> {
      const result = new Map<string, DocumentWithContent>()
      if (documentIds.length === 0) return result

      const docs = await repos.documents.findByIds(documentIds)
      if (docs.length === 0) return result

      for (const doc of docs) {
        const content = await getDocumentContent(doc.id)
        result.set(doc.id, { ...doc, content })
      }
      return result
    },

    listForProject: listDocumentsForProject,

    create: createDocument,

    async createForProject(
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

      return transaction.run(async () => {
        const project = await repos.projects.findById(projectId)
        if (!project) return null

        const docs = await listDocumentsForProject(projectId)
        const finalPaths = docs.map((d) => normalizeDocumentPath(d.title)).concat(normalizedTitle)
        if (hasPathCollision(finalPaths) || hasAncestorFileConflict(finalPaths)) {
          return null
        }

        const doc = await createDocument(normalizedTitle, content, type)
        await repos.projectDocuments.insert({
          projectId,
          documentId: doc.id,
          addedAt: Date.now(),
        })
        return doc
      })
    },

    async update(
      id: string,
      data: { title?: string; metadata?: JsonObject | null }
    ): Promise<DocumentWithContent | null> {
      if (!isValidId(id)) return null
      const doc = await repos.documents.findById(id)
      if (!doc) return null

      const now = Date.now()
      await repos.documents.update(id, {
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
    },

    async updateForProject(
      projectId: string,
      documentId: string,
      data: { title?: string; metadata?: JsonObject | null }
    ): Promise<DocumentWithContent | null> {
      const existing = await getProjectScopedDocument(repos, projectId, documentId)
      if (!existing) return null

      if (data.title === undefined) {
        return this.update(documentId, data)
      }

      const normalizedTitle = normalizeDocumentPath(data.title)
      if (!normalizedTitle) return null
      if (isDirectorySentinelPath(normalizedTitle)) return null
      if (pathHasSentinelSegment(normalizedTitle)) return null

      const docs = await listDocumentsForProject(projectId)
      const finalPaths = docs.map((d) => {
        if (d.id === documentId) return normalizedTitle
        return normalizeDocumentPath(d.title)
      })
      if (hasPathCollision(finalPaths) || hasAncestorFileConflict(finalPaths)) {
        return null
      }

      return this.update(documentId, { ...data, title: normalizedTitle })
    },

    async delete(id: string): Promise<boolean> {
      if (!isValidId(id)) return false
      const doc = await repos.documents.findById(id)
      if (!doc) return false

      await transaction.run(async () => {
        await repos.documents.deleteById(id)
        await repos.yjsDocuments.delete(id)
      })

      return true
    },

    async deleteForProject(projectId: string, documentId: string): Promise<boolean> {
      if (!(await getProjectScopedDocument(repos, projectId, documentId))) return false
      return this.delete(documentId)
    },

    async setDefaultForProject(projectId: string, documentId: string): Promise<boolean> {
      const doc = await getProjectScopedDocument(repos, projectId, documentId)
      if (!doc) return false
      await transaction.run(async () => {
        await setProjectDefaultDocument(projectId, documentId)
      })
      return true
    },

    async openOrCreateDefaultForProject(projectId: string): Promise<DocumentWithContent | null> {
      if (!isValidId(projectId)) return null

      const project = await repos.projects.findById(projectId)
      if (!project) return null

      const initialDocs = await listDocumentsForProject(projectId)
      const initialVisibleDocs = listVisibleDocuments(initialDocs)
      const metadataDefaultDocumentId = getDefaultDocumentIdFromMetadata(project.metadata)

      if (metadataDefaultDocumentId) {
        const preferred = initialVisibleDocs.find((d) => d.id === metadataDefaultDocumentId)
        if (preferred) return getDocumentWithContent(preferred.id)
      }

      if (initialVisibleDocs.length > 0) {
        const fallback = initialVisibleDocs[0]!
        await transaction.run(async () => {
          await setProjectDefaultDocument(projectId, fallback.id)
        })
        return getDocumentWithContent(fallback.id)
      }

      return transaction.run(async () => {
        const docs = await listDocumentsForProject(projectId)
        const visibleDocs = listVisibleDocuments(docs)
        if (visibleDocs.length > 0) {
          const fallback = visibleDocs[0]!
          await setProjectDefaultDocument(projectId, fallback.id)
          return getDocumentWithContent(fallback.id)
        }

        const existingPaths = docs.map((d) => normalizeDocumentPath(d.title))
        const title = nextDefaultDocumentPath(existingPaths)
        const created = await this.createForProject(projectId, title)
        if (!created) return null
        await setProjectDefaultDocument(projectId, created.id)
        return created
      })
    },

    async moveForProject(
      projectId: string,
      documentId: string,
      destinationPath: string
    ): Promise<DocumentWithContent | null> {
      const sourceDoc = await getProjectScopedDocument(repos, projectId, documentId)
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
      const finalPaths = docs.map((d) => {
        if (d.id === documentId) return normalizedDestinationPath
        return normalizeDocumentPath(d.title)
      })

      if (hasPathCollision(finalPaths) || hasAncestorFileConflict(finalPaths)) {
        return null
      }

      return this.update(documentId, { title: normalizedDestinationPath })
    },

    async moveDirectoryForProject(
      projectId: string,
      sourcePath: string,
      destinationPath: string
    ): Promise<{ movedDocumentIds: string[]; destinationPath: string } | null> {
      if (!isValidId(projectId)) return null

      const normalizedSourcePath = normalizeDocumentPath(sourcePath)
      const normalizedDestinationPath = normalizeDocumentPath(destinationPath)
      if (!normalizedSourcePath || !normalizedDestinationPath) return null
      if (
        pathHasSentinelSegment(normalizedSourcePath) ||
        pathHasSentinelSegment(normalizedDestinationPath)
      ) {
        return null
      }
      if (normalizedSourcePath === normalizedDestinationPath) {
        return { movedDocumentIds: [], destinationPath: normalizedDestinationPath }
      }
      if (isPathInsideDirectory(normalizedDestinationPath, normalizedSourcePath)) return null

      const docs = await listDocumentsForProject(projectId)
      const hasSourceDirectory = docs.some((d) => {
        const normalizedTitle = normalizeDocumentPath(d.title)
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
        const remappedPath = suffix
          ? `${normalizedDestinationPath}/${suffix}`
          : normalizedDestinationPath
        updates.set(doc.id, normalizeDocumentPath(remappedPath))
        movedDocumentIds.push(doc.id)
      }

      if (updates.size === 0) return null

      const finalPaths = docs.map((d) => updates.get(d.id) ?? normalizeDocumentPath(d.title))
      if (hasPathCollision(finalPaths) || hasAncestorFileConflict(finalPaths)) {
        return null
      }

      const updatedAt = Date.now()
      await transaction.run(async () => {
        for (const [docId, title] of updates) {
          await repos.documents.update(docId, { title, updatedAt })
        }
      })

      return { movedDocumentIds, destinationPath: normalizedDestinationPath }
    },

    async createDirectoryForProject(
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
        (d) => normalizeDocumentPath(d.title) === sentinelPath && isDirectorySentinelPath(d.title)
      )
      if (existingSentinel) {
        return getDocumentWithContent(existingSentinel.id)
      }

      return this.createForProject(projectId, sentinelPath, undefined, 'directory-sentinel')
    },

    async deleteDirectoryForProject(
      projectId: string,
      directoryPath: string
    ): Promise<{ deletedDocumentIds: string[] } | null> {
      if (!isValidId(projectId)) return null

      const normalizedDirectory = normalizeDocumentPath(directoryPath)
      if (!normalizedDirectory) return null
      if (pathHasSentinelSegment(normalizedDirectory)) return null

      const docs = await listDocumentsForProject(projectId)
      const docsToDelete = docs.filter((d) => {
        const normalizedTitle = normalizeDocumentPath(d.title)
        if (isDirectorySentinelPath(normalizedTitle)) {
          const sentinelDirectory = directoryPathFromSentinel(normalizedTitle)
          if (!sentinelDirectory) return false
          return isPathInsideDirectory(sentinelDirectory, normalizedDirectory)
        }
        return isPathInsideDirectory(normalizedTitle, normalizedDirectory)
      })

      if (docsToDelete.length === 0) return null

      await transaction.run(async () => {
        for (const doc of docsToDelete) {
          await repos.documents.deleteById(doc.id)
          await repos.yjsDocuments.delete(doc.id)
        }
      })

      return { deletedDocumentIds: docsToDelete.map((d) => d.id) }
    },

    getForProject: async (
      projectId: string,
      documentId: string
    ): Promise<DocumentWithContent | null> => {
      const doc = await getProjectScopedDocument(repos, projectId, documentId)
      if (!doc) return null
      return getDocumentWithContent(documentId)
    },

    async importForProject(
      projectId: string,
      title: string,
      markdown: string
    ): Promise<ImportDocumentResult> {
      if (!isValidId(projectId)) {
        return { ok: false, error: { kind: 'invalid_project_id' } }
      }

      const normalizedTitle = normalizeDocumentPath(title)
      if (!normalizedTitle) {
        return { ok: false, error: { kind: 'invalid_path' } }
      }

      if (isDirectorySentinelPath(normalizedTitle) || pathHasSentinelSegment(normalizedTitle)) {
        return { ok: false, error: { kind: 'invalid_path' } }
      }

      const parseResult = markdownToProseMirrorDoc(markdown)
      if (!parseResult.ok) {
        return {
          ok: false,
          error: { kind: 'markdown_parse_failed', cause: parseResult.error.cause },
        }
      }

      return transaction.run(async () => {
        const project = await repos.projects.findById(projectId)
        if (!project) {
          return { ok: false, error: { kind: 'project_not_found' } }
        }

        const docs = await listDocumentsForProject(projectId)
        const existingPaths = docs.map((d) => normalizeDocumentPath(d.title))
        const uniquePath = resolveUniqueImportPath(normalizedTitle, existingPaths)
        const content = JSON.stringify({ doc: parseResult.value, aiDraft: null })

        const doc = await createDocument(uniquePath, content)
        await repos.projectDocuments.insert({
          projectId,
          documentId: doc.id,
          addedAt: Date.now(),
        })

        return { ok: true, doc } as const
      })
    },

    async getVersionHistory(id: string): Promise<VersionSnapshot[]> {
      if (!isValidId(id)) return []
      const rows = await repos.versionSnapshots.findMetadataByDocumentId(id)
      return rows.map((r: { id: string; documentId: string; createdAt: number }) => ({
        id: r.id,
        documentId: r.documentId,
        createdAt: r.createdAt,
      }))
    },

    async getVersionHistoryForProject(
      projectId: string,
      documentId: string
    ): Promise<VersionSnapshot[]> {
      if (!(await getProjectScopedDocument(repos, projectId, documentId))) return []
      return this.getVersionHistory(documentId)
    },

    async createSnapshot(id: string): Promise<VersionSnapshot | null> {
      if (!isValidId(id)) return null
      const doc = await repos.documents.findById(id)
      if (!doc) return null

      const yjsData = await repos.yjsDocuments.getLatest(id)
      if (!yjsData) return null

      const ydoc = new Y.Doc()
      Y.applyUpdate(ydoc, new Uint8Array(yjsData))
      const content = JSON.stringify(yDocToProsemirrorJSON(ydoc))
      ydoc.destroy()

      const snapshotId = nanoid()
      const createdAt = Date.now()
      await repos.versionSnapshots.insert({ id: snapshotId, documentId: id, content, createdAt })

      return { id: snapshotId, documentId: id, createdAt }
    },

    async createSnapshotForProject(
      projectId: string,
      documentId: string
    ): Promise<VersionSnapshot | null> {
      if (!(await getProjectScopedDocument(repos, projectId, documentId))) return null
      return this.createSnapshot(documentId)
    },

    async restoreToSnapshot(
      documentId: string,
      snapshotId: string
    ): Promise<DocumentWithContent | null> {
      if (!isValidId(documentId) || !isValidId(snapshotId)) return null

      const doc = await repos.documents.findById(documentId)
      if (!doc) return null

      const snapshot = await repos.versionSnapshots.findCursorById(documentId, snapshotId)
      if (!snapshot) return null

      const content = parseJsonObjectContent(snapshot.content)
      if (!content) return null

      const { schema } = await import('@lucentdocs/shared')
      const replacementDoc = prosemirrorJSONToYDoc(schema, content)
      const replacementState = Y.encodeStateAsUpdate(replacementDoc)
      replacementDoc.destroy()

      const restoredAt = Date.now()

      await transaction.run(async () => {
        await repos.versionSnapshots.deleteSnapshotsAfterCursor(
          documentId,
          snapshot.createdAt,
          snapshot.rowId
        )
        await repos.yjsDocuments.set(documentId, Buffer.from(replacementState))
        await repos.documents.update(documentId, { updatedAt: restoredAt })
      })

      return {
        ...doc,
        updatedAt: restoredAt,
        content: JSON.stringify(content),
      }
    },

    async restoreToSnapshotForProject(
      projectId: string,
      documentId: string,
      snapshotId: string
    ): Promise<DocumentWithContent | null> {
      if (!(await getProjectScopedDocument(repos, projectId, documentId))) return null
      return this.restoreToSnapshot(documentId, snapshotId)
    },
  }
}
