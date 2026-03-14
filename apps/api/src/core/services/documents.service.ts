import { nanoid } from 'nanoid'
import * as Y from 'yjs'
import {
  isValidId,
  type Document,
  type JsonObject,
  createDefaultContent,
  parseContent,
  normalizeDocumentPath,
  isDirectorySentinelPath,
  pathHasSentinelSegment,
  isPathInsideDirectory,
  directoryPathFromSentinel,
  toDirectorySentinelPath,
  isJsonObject,
} from '@lucentdocs/shared'
import { markdownToProseMirrorDoc, type MarkdownRawHtmlMode } from '../markdown/native.js'
import { yDocToProsemirrorJSON, prosemirrorJSONToYDoc } from 'y-prosemirror'
import type { RepositorySet } from '../../core/ports/types.js'
import type { TransactionPort } from '../../core/ports/transaction.port.js'
import { configManager } from '../../config/runtime.js'
import { getEmbeddingProvider } from '../../embeddings/provider.js'
import type { ProjectDocumentEmbeddingSearchMatch } from '../ports/documentEmbeddings.port.js'
import type { AiSettingsService } from './aiSettings.service.js'
import {
  buildSnippetPreview as buildSearchSnippetPreview,
  normalizeValidatedSearchText,
  rangesSubstantiallyOverlap,
} from './documentSearch.js'

export interface DocumentWithContent extends Document {
  content: string
}

export interface VersionSnapshot {
  id: string
  documentId: string
  createdAt: number
}

export interface ProjectDocumentSearchSnippet {
  text: string
  selectionFrom: number
  selectionTo: number
  score: number
}

export interface ProjectDocumentSearchResult {
  id: string
  title: string
  type: string
  metadata: JsonObject | null
  createdAt: number
  updatedAt: number
  score: number
  matchType: 'snippet' | 'whole_document'
  snippets: ProjectDocumentSearchSnippet[]
}

export interface ProjectDocumentSemanticSearchMatch {
  strategyType: 'whole_document' | 'sliding_window'
  chunkOrdinal: number
  chunkStart: number
  chunkEnd: number
  selectionFrom: number | null
  selectionTo: number | null
  chunkText: string
  score: number
}

export type ImportDocumentErrorKind =
  | 'invalid_project_id'
  | 'invalid_path'
  | 'project_not_found'
  | 'markdown_parse_failed'

export type ImportDocumentParseFailureMode = 'fail' | 'code_block'

export interface ImportDocumentError {
  kind: ImportDocumentErrorKind
  cause?: unknown
}

export type ImportDocumentResult =
  | { ok: true; doc: DocumentWithContent }
  | { ok: false; error: ImportDocumentError }

export interface ImportManyDocumentInput {
  title: string
  markdown: string
}

export interface ImportManyDocumentFailure {
  title: string
  error: ImportDocumentError
}

export interface ImportManyDocumentsResult {
  imported: DocumentWithContent[]
  failed: ImportManyDocumentFailure[]
}

function buildCodeBlockDoc(markdown: string): JsonObject {
  return {
    type: 'doc',
    content: [
      {
        type: 'code_block',
        content: [{ type: 'text', text: markdown.replace(/\r\n?/g, '\n') }],
      },
    ],
  } as unknown as JsonObject
}

export interface DocumentsService {
  getById(id: string): Promise<Document | null>
  getWithContent(id: string): Promise<DocumentWithContent | null>
  getContent(id: string): Promise<string>
  getWithContentByIds(documentIds: string[]): Promise<Map<string, DocumentWithContent>>
  listAllIds(): Promise<string[]>
  listForProject(projectId: string): Promise<Document[]>
  searchForProject(
    projectId: string,
    query: string,
    options?: { limit?: number; maxSnippetsPerDocument?: number }
  ): Promise<ProjectDocumentSearchResult[]>
  searchForProjectDocument(
    projectId: string,
    documentId: string,
    query: string,
    options?: { limit?: number }
  ): Promise<ProjectDocumentSemanticSearchMatch[]>
  hasProjectAssociation(projectId: string, documentId: string): Promise<boolean>

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

  importManyForProject(
    projectId: string,
    documents: ImportManyDocumentInput[],
    options?: {
      parseFailureMode?: ImportDocumentParseFailureMode
      rawHtmlMode?: MarkdownRawHtmlMode
    }
  ): Promise<ImportManyDocumentsResult>

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

export interface DocumentContentObserver {
  onDocumentContentStored?(documentId: string): Promise<void> | void
  onDocumentsContentStored?(documentIds: string[]): Promise<void> | void
  onDocumentDeleted?(documentId: string): Promise<void> | void
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

async function getAssociatedProjectDocument(
  repos: RepositorySet,
  projectId: string,
  documentId: string
): Promise<Document | null> {
  if (!isValidId(projectId) || !isValidId(documentId)) return null
  if (!(await repos.projectDocuments.hasProjectDocument(projectId, documentId))) return null

  const doc = await repos.documents.findById(documentId)
  if (!doc) return null
  if (isDirectorySentinelPath(normalizeDocumentPath(doc.title))) return null
  return doc
}

/**
 * Resolves the effective search result limit, applying config defaults and caps.
 * Falls back to the configured default when no explicit limit is provided.
 * Always respects the configured maximum to prevent excessive result sets.
 */
function clampSearchLimit(limit: number | undefined): number {
  const config = configManager.getConfig().search
  if (limit === undefined) return config.defaultLimit
  if (!Number.isInteger(limit) || limit <= 0) return config.defaultLimit
  return Math.min(limit, config.maxLimit)
}

/**
 * Resolves the maximum snippets per document for search results.
 * Snippets show the matching text excerpt within a document; capping them
 * prevents overwhelming the UI when a single document has many matches.
 */
function clampSnippetLimit(limit: number | undefined): number {
  const config = configManager.getConfig().search
  if (limit === undefined) return config.snippetDefaultLimit
  if (!Number.isInteger(limit) || limit <= 0) return config.snippetDefaultLimit
  return Math.min(limit, config.snippetMaxLimit)
}

/**
 * Builds a human-readable preview snippet from chunk text, centering around
 * the first matching search term. The snippet is truncated to the configured
 * max length with ellipsis indicators when content is omitted.
 */
function buildSnippetPreview(chunkText: string, query: string): string {
  return buildSearchSnippetPreview(chunkText, query, {
    maxLength: configManager.getConfig().search.snippetMaxLength,
  })
}

/**
 * Aggregates raw embedding chunk matches into document-level search results.
 *
 * The embedding index stores text chunks, not whole documents. Multiple chunks
 * from the same document may match a query. This function:
 * 1. Groups chunks by document ID
 * 2. Assigns each document the best (lowest) distance score from its chunks
 * 3. Builds snippet previews for each match (up to maxSnippetsPerDocument)
 * 4. Deduplicates overlapping snippets to avoid showing redundant content
 * 5. Sorts results by score (best first), with recency as a tiebreaker
 *
 * Whole-document matches are treated specially: they indicate the entire
 * document matched without a specific location, so no snippets are shown.
 */
function aggregateProjectSearchMatches(
  matches: ProjectDocumentEmbeddingSearchMatch[],
  query: string,
  maxSnippetsPerDocument: number,
  documentById: Map<string, Document>
): ProjectDocumentSearchResult[] {
  const resultsByDocumentId = new Map<string, ProjectDocumentSearchResult>()

  for (const match of matches) {
    const document = documentById.get(match.documentId)
    if (!document) continue

    let result = resultsByDocumentId.get(match.documentId)
    if (!result) {
      result = {
        id: document.id,
        title: document.title,
        type: document.type,
        metadata: document.metadata,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        score: match.distance,
        matchType: 'snippet',
        snippets: [],
      }
      resultsByDocumentId.set(match.documentId, result)
    } else {
      result.score = Math.min(result.score, match.distance)
    }

    const isWholeDocumentMatch = match.strategyType === 'whole_document'

    if (isWholeDocumentMatch) {
      result.matchType = 'whole_document'
      result.snippets = []
      continue
    }

    if (result.matchType === 'whole_document') {
      continue
    }

    const snippetText = buildSnippetPreview(match.chunkText, query)
    if (!snippetText) continue

    if (result.snippets.length >= maxSnippetsPerDocument) continue

    const selectionFrom = match.selectionFrom
    const selectionTo = match.selectionTo
    if (selectionFrom === null || selectionTo === null) continue

    const nextRange = { start: selectionFrom, end: selectionTo }
    if (
      result.snippets.some(
        (snippet) =>
          snippet.text === snippetText ||
          rangesSubstantiallyOverlap(nextRange, {
            start: snippet.selectionFrom,
            end: snippet.selectionTo,
          })
      )
    ) {
      continue
    }

    result.snippets.push({
      text: snippetText,
      selectionFrom,
      selectionTo,
      score: match.distance,
    })
  }

  return [...resultsByDocumentId.values()]
    .map((result) => ({
      ...result,
      snippets: result.snippets.sort((left, right) => left.score - right.score),
    }))
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score
      return right.updatedAt - left.updatedAt
    })
}

export function createDocumentsService(
  repos: RepositorySet,
  transaction: TransactionPort,
  aiSettingsServiceOrObserver?: AiSettingsService | DocumentContentObserver,
  observer: DocumentContentObserver = {}
): DocumentsService {
  const aiSettingsService =
    aiSettingsServiceOrObserver && 'resolveRuntimeSelection' in aiSettingsServiceOrObserver
      ? aiSettingsServiceOrObserver
      : null
  const resolvedObserver =
    aiSettingsServiceOrObserver && 'resolveRuntimeSelection' in aiSettingsServiceOrObserver
      ? observer
      : (aiSettingsServiceOrObserver ?? observer)

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

  const getDocumentsWithContentByIds = async (
    documentIds: string[]
  ): Promise<Map<string, DocumentWithContent>> => {
    const result = new Map<string, DocumentWithContent>()
    if (documentIds.length === 0) return result

    const docs = await repos.documents.findByIds(documentIds)
    if (docs.length === 0) return result

    for (const doc of docs) {
      const content = await getDocumentContent(doc.id)
      result.set(doc.id, { ...doc, content })
    }
    return result
  }

  const createDocument = async (
    title: string,
    content?: string,
    type: string = 'manuscript',
    options: { notifyObserver?: boolean } = {}
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

    if (options.notifyObserver !== false) {
      await resolvedObserver.onDocumentContentStored?.(id)
    }

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

    getWithContentByIds: getDocumentsWithContentByIds,

    async listAllIds(): Promise<string[]> {
      return repos.projectDocuments.listDocumentIds()
    },

    listForProject: listDocumentsForProject,

    /**
     * Performs semantic search over all documents linked to a project.
     *
     * The search uses vector embeddings to find documents whose content
     * semantically matches the query, not just keyword matches.
     *
     * Results are returned as document entries with snippet previews showing
     * where the match occurred. Multiple chunks from the same document are
     * aggregated into a single result with multiple snippets.
     *
     * The candidate multiplier logic ensures we fetch enough embedding chunks
     * to satisfy the requested document count: since one document can have
     * many matching chunks, we may need to fetch more chunks than the final
     * result count. We start small (limit * 4) and exponentially increase
     * (doubling each iteration) until we have enough unique documents or
     * hit the safety cap (limit * 12).
     *
     * @param projectId - The project to search within
     * @param query - The natural language search query
     * @param options.limit - Max results to return (uses config default if omitted)
     * @param options.maxSnippetsPerDocument - Max snippets per document (default 4)
     */
    async searchForProject(
      projectId: string,
      query: string,
      options?: { limit?: number; maxSnippetsPerDocument?: number }
    ): Promise<ProjectDocumentSearchResult[]> {
      if (!isValidId(projectId)) return []

      const normalizedQuery = normalizeValidatedSearchText(
        query,
        configManager.getConfig().search.maxQueryChars
      )
      if (!normalizedQuery) return []

      const limit = clampSearchLimit(options?.limit)
      const maxSnippetsPerDocument = clampSnippetLimit(options?.maxSnippetsPerDocument)
      if (!aiSettingsService) return []

      const selection = await aiSettingsService.resolveRuntimeSelection('embedding')
      const provider = await getEmbeddingProvider()
      const [queryResult] = await provider.embed([normalizedQuery])
      const queryEmbedding = queryResult?.embedding
      if (!queryEmbedding) return []

      const maxCandidateLimit = Math.max(limit * 12, 48)
      let candidateLimit = Math.max(limit * 4, 16)
      let bestResults: ProjectDocumentSearchResult[] = []

      while (candidateLimit <= maxCandidateLimit) {
        const matches = await repos.documentEmbeddings.searchProjectDocuments({
          projectId,
          baseURL: selection.baseURL,
          model: selection.model,
          queryEmbedding,
          limit: candidateLimit,
        })
        if (matches.length === 0) return []

        const documents = await repos.documents.findByIds(
          Array.from(new Set(matches.map((match) => match.documentId)))
        )
        bestResults = aggregateProjectSearchMatches(
          matches,
          normalizedQuery,
          maxSnippetsPerDocument,
          new Map(documents.map((document) => [document.id, document]))
        ).slice(0, limit)

        if (bestResults.length >= limit || matches.length < candidateLimit) {
          break
        }

        candidateLimit *= 2
      }

      return bestResults
    },

    async searchForProjectDocument(
      projectId: string,
      documentId: string,
      query: string,
      options?: { limit?: number }
    ): Promise<ProjectDocumentSemanticSearchMatch[]> {
      if (!(await getAssociatedProjectDocument(repos, projectId, documentId))) return []

      const normalizedQuery = normalizeValidatedSearchText(
        query,
        configManager.getConfig().search.maxQueryChars
      )
      if (!normalizedQuery) return []

      const limit = clampSearchLimit(options?.limit)
      if (!aiSettingsService) return []

      const selection = await aiSettingsService.resolveRuntimeSelection('embedding')
      const provider = await getEmbeddingProvider()
      const [queryResult] = await provider.embed([normalizedQuery])
      const queryEmbedding = queryResult?.embedding
      if (!queryEmbedding) return []

      const matches = await repos.documentEmbeddings.searchDocument({
        documentId,
        baseURL: selection.baseURL,
        model: selection.model,
        queryEmbedding,
        limit,
      })

      return matches.map((match) => ({
        strategyType: match.strategyType,
        chunkOrdinal: match.chunkOrdinal,
        chunkStart: match.chunkStart,
        chunkEnd: match.chunkEnd,
        selectionFrom: match.selectionFrom,
        selectionTo: match.selectionTo,
        chunkText: match.chunkText,
        score: match.distance,
      }))
    },

    async hasProjectAssociation(projectId: string, documentId: string): Promise<boolean> {
      if (!isValidId(projectId) || !isValidId(documentId)) return false
      return repos.projectDocuments.hasProjectDocument(projectId, documentId)
    },

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

      await resolvedObserver.onDocumentDeleted?.(id)

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

      for (const doc of docsToDelete) {
        await resolvedObserver.onDocumentDeleted?.(doc.id)
      }

      return { deletedDocumentIds: docsToDelete.map((d) => d.id) }
    },

    getForProject: async (
      projectId: string,
      documentId: string
    ): Promise<DocumentWithContent | null> => {
      const doc = await getAssociatedProjectDocument(repos, projectId, documentId)
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

    async importManyForProject(
      projectId: string,
      documents: ImportManyDocumentInput[],
      options: {
        parseFailureMode?: ImportDocumentParseFailureMode
        rawHtmlMode?: MarkdownRawHtmlMode
      } = {}
    ): Promise<ImportManyDocumentsResult> {
      const parseFailureMode = options.parseFailureMode ?? 'fail'

      if (!isValidId(projectId)) {
        return {
          imported: [],
          failed: documents.map((doc) => ({
            title: doc.title,
            error: { kind: 'invalid_project_id' },
          })),
        }
      }

      const candidates: Array<{
        requestedTitle: string
        normalizedTitle: string
        content: string
      }> = []
      const failed: ImportManyDocumentFailure[] = []

      for (const item of documents) {
        const normalizedTitle = normalizeDocumentPath(item.title)
        if (!normalizedTitle) {
          failed.push({ title: item.title, error: { kind: 'invalid_path' } })
          continue
        }

        if (isDirectorySentinelPath(normalizedTitle) || pathHasSentinelSegment(normalizedTitle)) {
          failed.push({ title: item.title, error: { kind: 'invalid_path' } })
          continue
        }

        const parseResult = markdownToProseMirrorDoc(item.markdown, {
          rawHtmlMode: options.rawHtmlMode,
        })
        if (!parseResult.ok) {
          if (parseFailureMode === 'code_block') {
            const docJson = buildCodeBlockDoc(item.markdown)
            candidates.push({
              requestedTitle: item.title,
              normalizedTitle,
              content: JSON.stringify({ doc: docJson, aiDraft: null }),
            })
            continue
          }

          failed.push({
            title: item.title,
            error: { kind: 'markdown_parse_failed', cause: parseResult.error.cause },
          })
          continue
        }

        candidates.push({
          requestedTitle: item.title,
          normalizedTitle,
          content: JSON.stringify({ doc: parseResult.value, aiDraft: null }),
        })
      }

      if (candidates.length === 0) {
        return { imported: [], failed }
      }

      const imported = await transaction.run(async () => {
        const project = await repos.projects.findById(projectId)
        if (!project) {
          const projectNotFoundFailures = documents.map((doc) => ({
            title: doc.title,
            error: { kind: 'project_not_found' } as ImportDocumentError,
          }))
          failed.push(...projectNotFoundFailures)
          return [] as DocumentWithContent[]
        }

        const docs = await listDocumentsForProject(projectId)
        const existingPaths: string[] = docs.map((d) => normalizeDocumentPath(d.title))
        const allocatedPaths = new Set(existingPaths.filter(Boolean))

        const created: DocumentWithContent[] = []
        for (const item of candidates) {
          const uniquePath = resolveUniqueImportPath(item.normalizedTitle, [...allocatedPaths])
          allocatedPaths.add(uniquePath)

          const doc = await createDocument(uniquePath, item.content, 'manuscript', {
            notifyObserver: false,
          })
          await repos.projectDocuments.insert({
            projectId,
            documentId: doc.id,
            addedAt: Date.now(),
          })
          created.push(doc)
        }

        return created
      })

      if (imported.length > 0) {
        const ids = imported.map((doc) => doc.id)
        if (resolvedObserver.onDocumentsContentStored) {
          await resolvedObserver.onDocumentsContentStored(ids)
        } else {
          for (const id of ids) {
            await resolvedObserver.onDocumentContentStored?.(id)
          }
        }
      }

      return { imported, failed }
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
      if (!(await getAssociatedProjectDocument(repos, projectId, documentId))) return []
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
      if (!(await getAssociatedProjectDocument(repos, projectId, documentId))) return null
      return this.createSnapshot(documentId)
    },

    /**
     * Restores a document to a previous snapshot version.
     *
     * This writes the snapshot content directly to the Yjs documents store (SQLite),
     * bypassing the in-memory Y.Doc. After this returns, the caller must call
     * `yjsRuntime.evictLiveDocument()` to close WebSocket connections and force
     * clients to reload with the restored content.
     *
     * The eviction step is critical - without it, the in-memory Y.Doc would still
     * contain the old content and could overwrite the restored state on the next
     * persistence flush.
     */
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

      await resolvedObserver.onDocumentContentStored?.(documentId)

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
      if (!(await getAssociatedProjectDocument(repos, projectId, documentId))) return null
      return this.restoreToSnapshot(documentId, snapshotId)
    },
  }
}
