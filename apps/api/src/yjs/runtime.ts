import { docs, getYDoc, setPersistence, setupWSConnection } from '@y/websocket-server/utils'
import * as Y from 'yjs'
import type { YjsDocumentsRepositoryPort } from '../core/ports/yjsDocuments.port.js'
import type { VersionSnapshotsRepositoryPort } from '../core/ports/versionSnapshots.port.js'
import {
  yDocToProsemirrorJSON,
  prosemirrorJSONToYDoc,
  updateYFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror'
import { createDefaultContent, parseContent, schema, type JsonObject } from '@lucentdocs/shared'
import { nanoid } from 'nanoid'
import type { Node as ProseMirrorNode } from 'prosemirror-model'

export { setupWSConnection }

export interface YjsRepositorySet {
  yjsDocuments: YjsDocumentsRepositoryPort
  versionSnapshots: VersionSnapshotsRepositoryPort
}

export interface YjsRuntimeConfig {
  persistenceFlushIntervalMs: number
  versionSnapshotIntervalMs: number
}

export interface YjsContentObserver {
  onDocumentPersisted?(documentName: string): Promise<void> | void
}

interface ProsemirrorTransformResult<T> {
  changed: boolean
  nextDoc: ProseMirrorNode
  result: T
}

export interface YjsDocumentVersion {
  epoch: number
  instance: number
}

export const YJS_RESTORE_CLOSE_CODE = 4401
export const YJS_RESTORE_CLOSE_REASON = 'document-restored'

/**
 * Manages the lifecycle of Yjs documents in memory and their persistence to storage.
 *
 * ## Architecture Overview
 *
 * This class integrates with @y/websocket-server which handles WebSocket connections
 * and maintains the in-memory `docs` map (document name -> Y.Doc). The websocket server
 * has its own persistence hooks that we configure via `setPersistence()`:
 *
 * - `bindState(documentName, doc)`: Called when a Y.Doc is first created in memory.
 *   We use this to load the document state from SQLite storage.
 *
 * - `writeState(documentName, doc)`: Called by y-websocket-server when the last
 *   WebSocket connection to a document closes. It persists the final state and
 *   destroys the Y.Doc. This is the normal cleanup path for idle documents.
 *
 * ## Document Lifecycle
 *
 * 1. A WebSocket client connects → y-websocket-server creates/retrieves Y.Doc
 * 2. `bindState` fires → we load persisted state from SQLite
 * 3. Clients edit → Y.Doc `update` events fire → we track dirty state
 * 4. Periodic flush loop → persists dirty documents to SQLite
 * 5. Last client disconnects → `writeState` fires → final persist + destroy
 *
 * ## Dirty Tracking
 *
 * We maintain two separate dirty flags for different purposes:
 *
 * - `#persistenceDirtyDocs`: Documents that have unsaved changes needing flush to SQLite.
 *   Cleared after each successful persist operation.
 *
 * - `#snapshotDirtyDocs`: Documents that have changes since their last version snapshot.
 *   Cleared after a snapshot is created. This prevents creating snapshots for unchanged
 *   documents every interval.
 *
 * ## Epoch Tracking
 *
 * We use epochs to detect stale document instances. When a document is replaced
 * (e.g., during restore), we bump its epoch. Any operations on the old Y.Doc
 * instance are rejected if the epoch doesn't match the current one.
 */
export class YjsRuntime {
  #persistenceInitialized = false
  #snapshotTimer: ReturnType<typeof setInterval> | null = null
  #persistenceFlushTimer: ReturnType<typeof setInterval> | null = null
  #config: YjsRuntimeConfig
  #repos: YjsRepositorySet
  #observer: YjsContentObserver
  #initializedDocs = new Set<string>()
  #initializingDocs = new Map<string, Promise<void>>()

  /** Documents with unsaved changes that need to be flushed to SQLite */
  #persistenceDirtyDocs = new Set<string>()

  /** Documents with changes since their last version snapshot */
  #snapshotDirtyDocs = new Set<string>()

  /** Epoch counter per document, incremented on replace/restore operations */
  #documentEpochs = new Map<string, number>()

  /** Monotonic live-instance counter per document, incremented on each rebind */
  #documentInstances = new Map<string, number>()

  /** Epoch attached to each Y.Doc instance, used to detect stale references */
  #docEpochs = new WeakMap<Y.Doc, number>()

  constructor(
    repos: YjsRepositorySet,
    config: YjsRuntimeConfig,
    observer: YjsContentObserver = {}
  ) {
    this.#repos = repos
    this.#config = config
    this.#observer = observer
  }

  /**
   * Initializes the persistence layer by registering callbacks with y-websocket-server.
   *
   * This must be called before any document operations. It sets up:
   * - `bindState`: Loads document state from SQLite when a Y.Doc is created
   * - `writeState`: Persists document state when the last connection closes
   * - Periodic flush loop: Persists dirty documents at configured intervals
   */
  initialize(): void {
    if (this.#persistenceInitialized) return

    setPersistence({
      provider: null,
      bindState: (documentName: string, doc: Y.Doc) => {
        void this.#initializeDocumentState(documentName, doc).catch((error) => {
          console.error(`Failed to load Yjs document ${documentName}:`, error)
        })
      },
      writeState: async (documentName: string, doc: Y.Doc) => {
        this.#persistenceDirtyDocs.delete(documentName)
        await this.#persistDocumentState(documentName, doc)
      },
    })

    this.#startPersistenceFlushLoop()
    this.#persistenceInitialized = true
  }

  async shutdown(): Promise<void> {
    this.stopSnapshotTimer()
    this.stopPersistenceFlushLoop()
    await this.flushAllDocumentStates()
  }

  async ensureDocumentLoaded(documentName: string): Promise<void> {
    this.#ensurePersistenceInitialized()
    const doc = getYDoc(documentName)
    await this.#initializeDocumentState(documentName, doc)
  }

  async getDocumentProsemirrorJson(documentName: string): Promise<JsonObject> {
    this.#ensurePersistenceInitialized()
    await this.ensureDocumentLoaded(documentName)
    const doc = getYDoc(documentName)
    return yDocToProsemirrorJSON(doc) as JsonObject
  }

  async replaceLiveDocumentContent(
    documentName: string,
    prosemirrorJson: JsonObject,
    options: { origin?: unknown } = {}
  ): Promise<void> {
    this.#ensurePersistenceInitialized()
    await this.ensureDocumentLoaded(documentName)
    const liveDoc = getYDoc(documentName)
    const replacementDoc = prosemirrorJSONToYDoc(schema, prosemirrorJson)

    try {
      const replacementRoot = replacementDoc.getXmlFragment('prosemirror')
      const clonedContent = replacementRoot.toArray().flatMap((node) => {
        const cloned = node.clone()
        if (cloned instanceof Y.XmlElement || cloned instanceof Y.XmlText) {
          return [cloned]
        }
        return []
      })

      liveDoc.transact(() => {
        const root = liveDoc.getXmlFragment('prosemirror')
        if (root.length > 0) {
          root.delete(0, root.length)
        }
        if (clonedContent.length > 0) {
          root.insert(0, clonedContent)
        }
      }, options.origin)
    } finally {
      replacementDoc.destroy()
    }
  }

  async applyProsemirrorTransform<T>(
    documentName: string,
    options: {
      origin?: unknown
      transform: (currentDoc: ProseMirrorNode) => ProsemirrorTransformResult<T>
    }
  ): Promise<ProsemirrorTransformResult<T>> {
    this.#ensurePersistenceInitialized()
    await this.ensureDocumentLoaded(documentName)
    const liveDoc = getYDoc(documentName)

    let transformed: ProsemirrorTransformResult<T> | null = null

    liveDoc.transact(() => {
      const root = liveDoc.getXmlFragment('prosemirror')
      const currentDoc = yXmlFragmentToProseMirrorRootNode(root, schema)
      transformed = options.transform(currentDoc)
      if (!transformed.changed) {
        return
      }

      updateYFragment(liveDoc, root, transformed.nextDoc, {
        mapping: new Map(),
        isOMark: new Map(),
      })
    }, options.origin)

    if (!transformed) {
      throw new Error(`Failed to apply ProseMirror transform for ${documentName}`)
    }

    return transformed
  }

  async flushAllDocumentStates(): Promise<void> {
    this.#ensurePersistenceInitialized()

    const persistOps: Promise<void>[] = []
    const flushed = new Set<string>(this.#persistenceDirtyDocs)
    const dirtyDocumentNames = [...this.#persistenceDirtyDocs]
    this.#persistenceDirtyDocs.clear()

    for (const documentName of dirtyDocumentNames) {
      const doc = docs.get(documentName)
      if (!doc) continue

      persistOps.push(
        this.#persistDocumentState(documentName, doc).catch((error) => {
          console.error(`Failed to flush Yjs document ${documentName}:`, error)
        })
      )
    }

    for (const [documentName, doc] of docs) {
      if (flushed.has(documentName)) continue

      persistOps.push(
        this.#persistDocumentState(documentName, doc).catch((error) => {
          console.error(`Failed to persist Yjs document ${documentName}:`, error)
        })
      )
    }

    await Promise.all(persistOps)
  }

  /**
   * Starts periodic version snapshot creation for connected documents.
   *
   * Only documents that are both connected (have active WebSocket sessions) AND
   * have been modified since their last snapshot will have a new snapshot created.
   * This prevents creating redundant snapshots for idle documents.
   */
  startSnapshotTimer(): void {
    this.#ensurePersistenceInitialized()
    if (this.#snapshotTimer || this.#config.versionSnapshotIntervalMs <= 0) return

    this.#snapshotTimer = setInterval(async () => {
      for (const [documentName, doc] of docs) {
        if (doc.conns.size === 0) continue
        if (!this.#snapshotDirtyDocs.has(documentName)) continue

        try {
          await this.#insertSnapshot(documentName, doc)
          this.#snapshotDirtyDocs.delete(documentName)
        } catch (error) {
          console.error(`Failed to create snapshot for ${documentName}:`, error)
        }
      }
    }, this.#config.versionSnapshotIntervalMs)
  }

  stopSnapshotTimer(): void {
    if (this.#snapshotTimer) {
      clearInterval(this.#snapshotTimer)
      this.#snapshotTimer = null
    }
  }

  stopPersistenceFlushLoop(): void {
    if (this.#persistenceFlushTimer) {
      clearInterval(this.#persistenceFlushTimer)
      this.#persistenceFlushTimer = null
    }
  }

  reloadRuntimeConfig(config: YjsRuntimeConfig): void {
    this.#config = config
    if (!this.#persistenceInitialized) return

    this.stopPersistenceFlushLoop()
    this.stopSnapshotTimer()
    this.#startPersistenceFlushLoop()
    this.startSnapshotTimer()
  }

  getRepos(): YjsRepositorySet {
    return this.#repos
  }

  /**
   * Captures the current document version for race detection across restores,
   * reconnects, and live in-memory document replacement.
   */
  captureDocumentVersion(documentName: string): YjsDocumentVersion {
    return {
      epoch: this.#getDocumentEpoch(documentName),
      instance: this.#documentInstances.get(documentName) ?? 0,
    }
  }

  /**
   * Returns whether the document's persisted state or live Y.Doc instance has
   * changed since a previously captured version snapshot.
   */
  hasDocumentChangedSince(documentName: string, version: YjsDocumentVersion): boolean {
    const current = this.captureDocumentVersion(documentName)
    return current.epoch !== version.epoch || current.instance !== version.instance
  }

  /**
   * Forcefully evicts a live document from memory, closing all WebSocket connections.
   *
   * This is used when a document is restored from a snapshot - the in-memory Y.Doc
   * contains the old content and must be replaced with a fresh instance that will
   * load the restored state from storage.
   *
   * ## Critical: Connection Clearing Order
   *
   * We clear `doc.conns` BEFORE closing the WebSocket connections. This is essential
   * because y-websocket-server's `closeConn()` function (in utils.js) checks if
   * `doc.conns.size === 0` to decide whether to call `writeState()`:
   *
   * ```js
   * // y-websocket-server closeConn() logic:
   * if (doc.conns.has(conn)) {
   *   doc.conns.delete(conn)
   *   if (doc.conns.size === 0 && persistence !== null) {
   *     persistence.writeState(doc.name, doc)  // <-- Would overwrite restored content!
   *   }
   * }
   * ```
   *
   * If we close connections without clearing `conns` first, `writeState` would be
   * called and overwrite the just-restored content in SQLite with the old in-memory
   * state. By clearing first, `doc.conns.has(conn)` returns false and the writeState
   * path is skipped.
   *
   * ## Restore Flow
   *
   * 1. `restoreToSnapshot()` writes restored content to SQLite
   * 2. This method closes WebSockets with a special close code
   * 3. Client sees the close code and reloads the page
   * 4. Page reload → new WebSocket → new Y.Doc → loads restored content from SQLite
   */
  evictLiveDocument(
    documentName: string,
    options: { closeCode?: number; closeReason?: string } = {}
  ): void {
    const liveDoc = docs.get(documentName)
    if (!liveDoc) return

    const connections = [...liveDoc.conns.keys()]
    liveDoc.conns.clear()

    for (const conn of connections) {
      if (options.closeCode !== undefined) {
        conn.close(options.closeCode, options.closeReason)
      } else {
        conn.close()
      }
    }

    liveDoc.destroy()
    docs.delete(documentName)
    this.#initializedDocs.delete(documentName)
    this.#initializingDocs.delete(documentName)
    this.#persistenceDirtyDocs.delete(documentName)
    this.#snapshotDirtyDocs.delete(documentName)
  }

  bumpDocumentEpoch(documentName: string): number {
    const nextEpoch = (this.#documentEpochs.get(documentName) ?? 0) + 1
    this.#documentEpochs.set(documentName, nextEpoch)
    return nextEpoch
  }

  /**
   * Replaces a document's persisted state and optionally evicts the live instance.
   *
   * This is the low-level operation used by restore functionality. It:
   * 1. Encodes the new content as Yjs state
   * 2. Writes it directly to SQLite (bypassing the in-memory Y.Doc)
   * 3. Bumps the document epoch to invalidate any existing Y.Doc instances
   * 4. Evicts the live document so clients reconnect with fresh state
   */
  async replaceDocument(
    documentName: string,
    prosemirrorJson: JsonObject,
    options: { evictLive?: boolean; closeCode?: number; closeReason?: string } = {}
  ): Promise<void> {
    this.#ensurePersistenceInitialized()

    const replacementDoc = prosemirrorJSONToYDoc(schema, prosemirrorJson)
    const replacementState = Y.encodeStateAsUpdate(replacementDoc)
    replacementDoc.destroy()

    const previousEpoch = this.#documentEpochs.get(documentName)
    this.bumpDocumentEpoch(documentName)

    try {
      await this.#repos.yjsDocuments.set(documentName, Buffer.from(replacementState))
    } catch (error) {
      if (previousEpoch === undefined) {
        this.#documentEpochs.delete(documentName)
      } else {
        this.#documentEpochs.set(documentName, previousEpoch)
      }
      throw error
    }

    if (options.evictLive ?? true) {
      this.evictLiveDocument(documentName, {
        closeCode: options.closeCode,
        closeReason: options.closeReason,
      })
    }
  }

  #ensurePersistenceInitialized(): void {
    if (!this.#persistenceInitialized) {
      throw new Error('YjsRuntime not initialized. Call initialize() first.')
    }
  }

  #startPersistenceFlushLoop(): void {
    if (this.#persistenceFlushTimer) return

    this.#persistenceFlushTimer = setInterval(() => {
      void this.#flushDirtyDocuments()
    }, this.#config.persistenceFlushIntervalMs)

    if (typeof this.#persistenceFlushTimer.unref === 'function') {
      this.#persistenceFlushTimer.unref()
    }
  }

  /**
   * Persists all dirty documents to SQLite.
   *
   * This runs on a timer and ensures changes are durably stored even if clients
   * disconnect unexpectedly. After successful persist, documents are removed from
   * the dirty set. Failed persists re-add documents to the dirty set for retry.
   */
  async #flushDirtyDocuments(): Promise<void> {
    if (this.#persistenceDirtyDocs.size === 0) return

    const dirtyDocumentNames = [...this.#persistenceDirtyDocs]
    this.#persistenceDirtyDocs.clear()

    await Promise.all(
      dirtyDocumentNames.map(async (documentName) => {
        const doc = docs.get(documentName)
        if (!doc) return

        try {
          await this.#persistDocumentState(documentName, doc)
        } catch (error) {
          console.error(`Failed to persist Yjs document ${documentName}:`, error)
          this.#persistenceDirtyDocs.add(documentName)
        }
      })
    )
  }

  async #persistDocumentState(documentName: string, doc: Y.Doc): Promise<void> {
    if (!this.#isCurrentDocumentInstance(documentName, doc)) return

    const state = Y.encodeStateAsUpdate(doc)
    const buffer = Buffer.from(state)

    await this.#repos.yjsDocuments.set(documentName, buffer)
    await this.#observer.onDocumentPersisted?.(documentName)
  }

  async #insertSnapshot(documentName: string, doc: Y.Doc): Promise<void> {
    const snapshotId = nanoid()
    const createdAt = Date.now()
    const content = JSON.stringify(yDocToProsemirrorJSON(doc))
    await this.#repos.versionSnapshots.insert({
      id: snapshotId,
      documentId: documentName,
      content,
      createdAt,
    })
  }

  async #createAndPersistDefaultContent(documentName: string, doc: Y.Doc): Promise<void> {
    const parsed = parseContent(createDefaultContent())
    const defaultDoc = prosemirrorJSONToYDoc(schema, parsed.doc)
    const update = Y.encodeStateAsUpdate(defaultDoc)
    Y.applyUpdate(doc, update)
    defaultDoc.destroy()

    await this.#persistDocumentState(documentName, doc)
  }

  /**
   * Loads a document's state from SQLite and sets up dirty tracking.
   *
   * This is called by y-websocket-server's `bindState` hook when a Y.Doc is
   * first created. It loads the persisted state and registers event handlers
   * for tracking when the document becomes dirty (modified).
   */
  async #initializeDocumentState(documentName: string, doc: Y.Doc): Promise<void> {
    if (this.#initializedDocs.has(documentName)) {
      if (this.#isCurrentDocumentInstance(documentName, doc)) return
      throw new Error(`Stale Yjs document instance for ${documentName}`)
    }

    const existingInit = this.#initializingDocs.get(documentName)
    if (existingInit) {
      await existingInit

      if (
        this.#initializedDocs.has(documentName) &&
        this.#isCurrentDocumentInstance(documentName, doc)
      ) {
        return
      }

      throw new Error(`Stale Yjs document instance for ${documentName}`)
    }

    const initPromise = (async () => {
      this.#setDocEpoch(documentName, doc)
      this.#documentInstances.set(
        documentName,
        (this.#documentInstances.get(documentName) ?? 0) + 1
      )

      const data = await this.#repos.yjsDocuments.getPersisted(documentName)

      if (data) {
        Y.applyUpdate(doc, new Uint8Array(data))
      } else {
        await this.#createAndPersistDefaultContent(documentName, doc)
      }

      doc.on('update', () => {
        if (!this.#isCurrentDocumentInstance(documentName, doc)) return
        this.#persistenceDirtyDocs.add(documentName)
        this.#snapshotDirtyDocs.add(documentName)
      })

      doc.on('destroy', () => {
        this.#persistenceDirtyDocs.delete(documentName)
        this.#snapshotDirtyDocs.delete(documentName)
        this.#initializedDocs.delete(documentName)
        this.#initializingDocs.delete(documentName)
      })

      this.#initializedDocs.add(documentName)
    })()

    this.#initializingDocs.set(documentName, initPromise)

    try {
      await initPromise
    } finally {
      if (this.#initializingDocs.get(documentName) === initPromise) {
        this.#initializingDocs.delete(documentName)
      }
    }
  }

  #getDocumentEpoch(documentName: string): number {
    return this.#documentEpochs.get(documentName) ?? 0
  }

  #getDocEpoch(doc: Y.Doc): number {
    return this.#docEpochs.get(doc) ?? 0
  }

  #isCurrentDocumentInstance(documentName: string, doc: Y.Doc): boolean {
    return this.#getDocEpoch(doc) === this.#getDocumentEpoch(documentName)
  }

  #setDocEpoch(documentName: string, doc: Y.Doc): void {
    this.#docEpochs.set(doc, this.#getDocumentEpoch(documentName))
  }
}

export function createYjsRuntime(
  repos: YjsRepositorySet,
  config: YjsRuntimeConfig,
  observer: YjsContentObserver = {}
): YjsRuntime {
  return new YjsRuntime(repos, config, observer)
}
