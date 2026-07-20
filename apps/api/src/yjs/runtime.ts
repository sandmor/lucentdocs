import { docs, getYDoc, setPersistence, setupWSConnection } from '@y/websocket-server/utils'
import * as Y from 'yjs'
import type { YjsDocumentsRepositoryPort } from '../core/ports/yjsDocuments.port.js'
import type { VersionSnapshotsRepositoryPort } from '../core/ports/versionSnapshots.port.js'
import type { DocumentContentRepositoryPort } from '../core/ports/documentContent.port.js'
import type { DocumentNotesRepositoryPort } from '../core/ports/documentNotes.port.js'
import {
  prosemirrorJSONToYDoc,
  updateYFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror'
import {
  createDefaultContent,
  ensureBlockIds,
  parseContent,
  schema,
  serializeVersionSnapshotBundle,
  type JsonObject,
  type VersionSnapshotBundle,
} from '@lucentdocs/shared'
import { nanoid } from 'nanoid'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import {
  hydrateNotesMap,
  notesMapToRecords,
  reconcileNotesAfterDocumentEdit,
  snapshotsFromRecords,
  getNotesMap,
  serializeNotesMap,
  type SerializedNoteFromYjs,
} from './document-notes.js'

export { setupWSConnection }

export interface YjsRepositorySet {
  yjsDocuments: YjsDocumentsRepositoryPort
  versionSnapshots: VersionSnapshotsRepositoryPort
  documentContent: DocumentContentRepositoryPort
  documentNotes: DocumentNotesRepositoryPort
}

export interface YjsRuntimeConfig {
  persistenceFlushIntervalMs: number
  versionSnapshotIntervalMs: number
}

export interface YjsContentObserver {
  onDocumentPersisted?(documentName: string, prosemirrorJson: JsonObject): Promise<void> | void
}

interface ProsemirrorTransformResult<T> {
  changed: boolean
  nextDoc: ProseMirrorNode
  result: T
}

interface ProsemirrorTransformContext {
  notes: readonly SerializedNoteFromYjs[]
}

export interface YjsDocumentVersion {
  epoch: number
  instance: number
}

export const YJS_RESTORE_CLOSE_CODE = 4401
export const YJS_RESTORE_CLOSE_REASON = 'document-restored'

export class YjsRuntime {
  #persistenceInitialized = false
  #snapshotTimer: ReturnType<typeof setInterval> | null = null
  #persistenceFlushTimer: ReturnType<typeof setInterval> | null = null
  #config: YjsRuntimeConfig
  #repos: YjsRepositorySet
  #observer: YjsContentObserver
  #initializedDocs = new Set<string>()
  #initializingDocs = new Map<string, Promise<void>>()
  #persistenceDirtyDocs = new Set<string>()
  #snapshotDirtyDocs = new Set<string>()
  #documentEpochs = new Map<string, number>()
  #documentInstances = new Map<string, number>()
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
        const wasDirty = this.#persistenceDirtyDocs.delete(documentName)
        if (wasDirty) {
          await this.#persistDocumentState(documentName, doc)
        }
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

    // Prefer the live in-memory Yjs state when already loaded — it always reflects
    // the most recent edits even before they've been flushed to the canonical store.
    if (this.#initializedDocs.has(documentName) && docs.has(documentName)) {
      const doc = getYDoc(documentName)
      return ensureBlockIds(
        yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment('prosemirror'), schema).toJSON() as JsonObject
      )
    }

    // Doc not in memory — fall back to canonical store if available (avoids loading Yjs
    // just to read, which is expensive for background/offline reads).
    const canonical = await this.#repos.documentContent.findByDocumentId(documentName)
    if (canonical) {
      return JSON.parse(canonical.content) as JsonObject
    }

    // Last resort: cold-load from Yjs (handles legacy blobs before migration).
    await this.ensureDocumentLoaded(documentName)
    const doc = getYDoc(documentName)
    return ensureBlockIds(
      yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment('prosemirror'), schema).toJSON() as JsonObject
    )
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
      clearNotes?: boolean
      transform: (
        currentDoc: ProseMirrorNode,
        context: ProsemirrorTransformContext
      ) => ProsemirrorTransformResult<T>
    }
  ): Promise<ProsemirrorTransformResult<T>> {
    this.#ensurePersistenceInitialized()
    await this.ensureDocumentLoaded(documentName)
    const liveDoc = getYDoc(documentName)

    let transformed: ProsemirrorTransformResult<T> | null = null

    liveDoc.transact(() => {
      const root = liveDoc.getXmlFragment('prosemirror')
      const currentDoc = yXmlFragmentToProseMirrorRootNode(root, schema)
      transformed = options.transform(currentDoc, { notes: serializeNotesMap(liveDoc) })
      if (!transformed.changed) {
        return
      }

      updateYFragment(liveDoc, root, transformed.nextDoc, {
        mapping: new Map(),
        isOMark: new Map(),
      })
      if (options.clearNotes) {
        const notes = getNotesMap(liveDoc)
        for (const noteId of notes.keys()) notes.delete(noteId)
      }
    }, options.origin)

    if (!transformed) {
      throw new Error(`Failed to apply ProseMirror transform for ${documentName}`)
    }

    return transformed
  }

  async reconcileDocumentNotesAfterEdit(
    documentName: string,
    options: {
      deletedBlockIds: readonly string[]
      blockIdMigrations: ReadonlyArray<{ from: string; to: string }>
    }
  ): Promise<void> {
    this.#ensurePersistenceInitialized()
    await this.ensureDocumentLoaded(documentName)
    const liveDoc = getYDoc(documentName)
    liveDoc.transact(() => {
      reconcileNotesAfterDocumentEdit(getNotesMap(liveDoc), options)
    }, 'chat-edit-notes')
  }

  async flushAllDocumentStates(): Promise<void> {
    this.#ensurePersistenceInitialized()

    const persistOps: Promise<void>[] = []
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

    await Promise.all(persistOps)
  }

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

  captureDocumentVersion(documentName: string): YjsDocumentVersion {
    return {
      epoch: this.#getDocumentEpoch(documentName),
      instance: this.#documentInstances.get(documentName) ?? 0,
    }
  }

  hasDocumentChangedSince(documentName: string, version: YjsDocumentVersion): boolean {
    const current = this.captureDocumentVersion(documentName)
    return current.epoch !== version.epoch || current.instance !== version.instance
  }

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

  async replaceDocument(
    documentName: string,
    prosemirrorJson: JsonObject,
    options: { evictLive?: boolean; closeCode?: number; closeReason?: string } = {}
  ): Promise<void> {
    await this.replaceDocumentBundle(
      documentName,
      { doc: prosemirrorJson, notes: [] },
      options
    )
  }

  async replaceDocumentBundle(
    documentName: string,
    bundle: VersionSnapshotBundle,
    options: { evictLive?: boolean; closeCode?: number; closeReason?: string } = {}
  ): Promise<void> {
    this.#ensurePersistenceInitialized()

    const docJson = ensureBlockIds(bundle.doc)
    const noteRecords = bundle.notes.map((note) => ({
      id: note.id,
      documentId: documentName,
      anchorKind: note.anchorKind,
      anchorId: note.anchorId,
      content: JSON.stringify(note.content),
      authorUserId: note.authorUserId,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    }))

    const previousEpoch = this.#documentEpochs.get(documentName)
    this.bumpDocumentEpoch(documentName)

    try {
      await this.#repos.documentContent.upsert(documentName, docJson)
      await this.#repos.documentNotes.replaceAllForDocument(documentName, noteRecords)
      await this.#repos.yjsDocuments.delete(documentName)
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

  async buildSnapshotBundle(documentName: string, doc?: Y.Doc): Promise<VersionSnapshotBundle> {
    const liveDoc = doc ?? docs.get(documentName)
    if (liveDoc) {
      return {
        doc: ensureBlockIds(
          yXmlFragmentToProseMirrorRootNode(liveDoc.getXmlFragment('prosemirror'), schema).toJSON() as JsonObject
        ),
        notes: snapshotsFromRecords(notesMapToRecords(documentName, liveDoc)),
      }
    }

    const contentRow = await this.#repos.documentContent.findByDocumentId(documentName)
    const noteRows = await this.#repos.documentNotes.listByDocumentId(documentName)
    return {
      doc: contentRow
        ? ensureBlockIds(JSON.parse(contentRow.content) as JsonObject)
        : ensureBlockIds(parseContent(createDefaultContent()).doc),
      notes: snapshotsFromRecords(noteRows),
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

    const prosemirrorJson = ensureBlockIds(
      yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment('prosemirror'), schema).toJSON() as JsonObject
    )
    const noteRecords = notesMapToRecords(documentName, doc)
    const now = Date.now()

    const state = Y.encodeStateAsUpdate(doc)
    const buffer = Buffer.from(state)

    await this.#repos.yjsDocuments.set(documentName, buffer)
    await this.#repos.documentContent.upsert(documentName, prosemirrorJson, now)
    await this.#repos.documentNotes.replaceAllForDocument(documentName, noteRecords)

    await this.#observer.onDocumentPersisted?.(documentName, prosemirrorJson)
  }

  async #insertSnapshot(documentName: string, doc: Y.Doc): Promise<void> {
    const snapshotId = nanoid()
    const createdAt = Date.now()
    const bundle = await this.buildSnapshotBundle(documentName, doc)
    const content = serializeVersionSnapshotBundle(bundle)
    await this.#repos.versionSnapshots.insert({
      id: snapshotId,
      documentId: documentName,
      content,
      createdAt,
    })
  }

  async #createAndPersistDefaultContent(documentName: string, doc: Y.Doc): Promise<void> {
    const parsed = parseContent(createDefaultContent())
    const defaultDoc = ensureBlockIds(parsed.doc)
    const built = prosemirrorJSONToYDoc(schema, defaultDoc)
    const update = Y.encodeStateAsUpdate(built)
    Y.applyUpdate(doc, update)
    built.destroy()

    await this.#persistDocumentState(documentName, doc)
  }

  async #loadFromCanonical(documentName: string, doc: Y.Doc): Promise<void> {
    const contentRow = await this.#repos.documentContent.findByDocumentId(documentName)
    const noteRows = await this.#repos.documentNotes.listByDocumentId(documentName)

    if (!contentRow) {
      await this.#createAndPersistDefaultContent(documentName, doc)
      return
    }

    const pmJson = ensureBlockIds(JSON.parse(contentRow.content) as JsonObject)
    const built = prosemirrorJSONToYDoc(schema, pmJson)
    const update = Y.encodeStateAsUpdate(built)
    Y.applyUpdate(doc, update)
    built.destroy()
    hydrateNotesMap(doc, noteRows)
    await this.#persistDocumentState(documentName, doc)
  }

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

      const blob = await this.#repos.yjsDocuments.getPersisted(documentName)

      const contentRow = await this.#repos.documentContent.findByDocumentId(documentName)
      if (contentRow) {
        await this.#loadFromCanonical(documentName, doc)
      } else if (blob) {
        Y.applyUpdate(doc, new Uint8Array(blob))
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
