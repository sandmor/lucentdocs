import * as Y from 'yjs'
import { yDocToProsemirrorJSON } from 'y-prosemirror'
import {
  normalizeInlineZoneSession,
  normalizeInlineZoneSessionMap,
  type InlineZoneSession,
  type JsonObject,
} from '@lucentdocs/shared'
import type { RepositorySet } from '../core/ports/types.js'

const INLINE_SESSIONS_METADATA_KEY = 'inline_ai_sessions'

export interface InlineScope {
  projectId: string
  documentId: string
}

export interface PruneResult {
  sessions: Record<string, InlineZoneSession>
  removedSessionIds: string[]
}

interface ScopedDocument {
  metadata: JsonObject | null
}

function readInlineSessions(metadata: JsonObject | null): Record<string, InlineZoneSession> {
  if (!metadata) return {}
  return normalizeInlineZoneSessionMap(metadata[INLINE_SESSIONS_METADATA_KEY])
}

function writeInlineSessions(
  metadata: JsonObject | null,
  sessions: Record<string, InlineZoneSession>
): JsonObject | null {
  const nextMetadata: JsonObject = { ...(metadata ?? {}) }

  if (Object.keys(sessions).length === 0) {
    delete nextMetadata[INLINE_SESSIONS_METADATA_KEY]
  } else {
    nextMetadata[INLINE_SESSIONS_METADATA_KEY] = sessions as unknown as JsonObject
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : null
}

function mapHasSameKeysAndValues(
  left: Record<string, InlineZoneSession>,
  right: Record<string, InlineZoneSession>
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false

  for (const key of leftKeys) {
    const leftSession = left[key]
    const rightSession = right[key]
    if (!rightSession) return false
    if (JSON.stringify(leftSession) !== JSON.stringify(rightSession)) {
      return false
    }
  }

  return true
}

function collectSessionIdsFromProsemirrorNode(value: unknown, output: Set<string>): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return

  const record = value as Record<string, unknown>
  if (record.type === 'ai_zone') {
    const attrs =
      typeof record.attrs === 'object' && record.attrs !== null && !Array.isArray(record.attrs)
        ? (record.attrs as Record<string, unknown>)
        : null
    const sessionId = attrs?.sessionId
    if (typeof sessionId === 'string' && sessionId.trim().length > 0) {
      output.add(sessionId)
    }
  }

  const content = Array.isArray(record.content) ? record.content : []
  for (const child of content) {
    collectSessionIdsFromProsemirrorNode(child, output)
  }
}

export class InlineSessionMetadataStore {
  #repos: Pick<RepositorySet, 'documents' | 'projectDocuments' | 'yjsDocuments'>

  constructor(repos: Pick<RepositorySet, 'documents' | 'projectDocuments' | 'yjsDocuments'>) {
    this.#repos = repos
  }

  async isDocumentInScope(scope: InlineScope): Promise<boolean> {
    const soleProjectId = await this.#repos.projectDocuments.findSoleProjectIdByDocumentId(
      scope.documentId
    )
    if (soleProjectId !== scope.projectId) {
      return false
    }

    const document = await this.#repos.documents.findById(scope.documentId)
    return Boolean(document)
  }

  async getSession(
    scope: InlineScope,
    sessionId: string
  ): Promise<InlineZoneSession | null | undefined> {
    const sessions = await this.getSessions(scope, [sessionId])
    if (!sessions) return undefined
    return sessions[sessionId] ?? null
  }

  async getSessions(
    scope: InlineScope,
    requestedSessionIds?: readonly string[]
  ): Promise<Record<string, InlineZoneSession> | null> {
    const scopedDocument = await this.#loadScopedDocument(scope)
    if (!scopedDocument) return null
    const sessions = readInlineSessions(scopedDocument.metadata)

    if (!requestedSessionIds || requestedSessionIds.length === 0) {
      return sessions
    }

    const requestedSet = new Set(requestedSessionIds)
    const filtered: Record<string, InlineZoneSession> = {}
    for (const [sessionId, session] of Object.entries(sessions)) {
      if (!requestedSet.has(sessionId)) continue
      filtered[sessionId] = session
    }

    return filtered
  }

  async saveSession(
    scope: InlineScope,
    sessionId: string,
    session: InlineZoneSession
  ): Promise<boolean> {
    const normalizedSession = normalizeInlineZoneSession(session)
    if (!normalizedSession) {
      return false
    }

    const scopedDocument = await this.#loadScopedDocument(scope)
    if (!scopedDocument) return false
    const currentSessions = readInlineSessions(scopedDocument.metadata)

    const nextSessions: Record<string, InlineZoneSession> = {
      ...currentSessions,
      [sessionId]: normalizedSession,
    }

    if (mapHasSameKeysAndValues(currentSessions, nextSessions)) {
      return true
    }

    const nextMetadata = writeInlineSessions(scopedDocument.metadata, nextSessions)
    await this.#repos.documents.update(scope.documentId, {
      metadata: nextMetadata,
      updatedAt: Date.now(),
    })

    return true
  }

  async pruneOrphans(scope: InlineScope): Promise<PruneResult | null> {
    const scopedDocument = await this.#loadScopedDocument(scope)
    if (!scopedDocument) return null

    const currentSessions = readInlineSessions(scopedDocument.metadata)
    if (Object.keys(currentSessions).length === 0) {
      return {
        sessions: currentSessions,
        removedSessionIds: [],
      }
    }

    const referencedSessionIds = await this.#collectReferencedSessionIds(scope.documentId)
    const nextSessions: Record<string, InlineZoneSession> = {}
    const removedSessionIds: string[] = []

    for (const [sessionId, session] of Object.entries(currentSessions)) {
      if (referencedSessionIds.has(sessionId)) {
        nextSessions[sessionId] = session
      } else {
        removedSessionIds.push(sessionId)
      }
    }

    if (removedSessionIds.length === 0) {
      return {
        sessions: currentSessions,
        removedSessionIds: [],
      }
    }

    const nextMetadata = writeInlineSessions(scopedDocument.metadata, nextSessions)
    await this.#repos.documents.update(scope.documentId, {
      metadata: nextMetadata,
      updatedAt: Date.now(),
    })

    return {
      sessions: nextSessions,
      removedSessionIds,
    }
  }

  async #loadScopedDocument(scope: InlineScope): Promise<ScopedDocument | null> {
    if (!(await this.isDocumentInScope(scope))) {
      return null
    }

    const document = await this.#repos.documents.findById(scope.documentId)
    if (!document) return null

    return {
      metadata: document.metadata,
    }
  }

  async #collectReferencedSessionIds(documentId: string): Promise<Set<string>> {
    const yjsData = await this.#repos.yjsDocuments.getLatest(documentId)
    if (!yjsData) return new Set()

    const ydoc = new Y.Doc()
    try {
      Y.applyUpdate(ydoc, new Uint8Array(yjsData))
      const json = yDocToProsemirrorJSON(ydoc)
      const sessionIds = new Set<string>()
      collectSessionIdsFromProsemirrorNode(json, sessionIds)
      return sessionIds
    } finally {
      ydoc.destroy()
    }
  }
}

export function createInlineSessionMetadataStore(
  repos: Pick<RepositorySet, 'documents' | 'projectDocuments' | 'yjsDocuments'>
): InlineSessionMetadataStore {
  return new InlineSessionMetadataStore(repos)
}
