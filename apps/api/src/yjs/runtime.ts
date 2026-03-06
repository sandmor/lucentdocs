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

interface ProsemirrorTransformResult<T> {
  changed: boolean
  nextDoc: ProseMirrorNode
  result: T
}

export const YJS_RESTORE_CLOSE_CODE = 4401
export const YJS_RESTORE_CLOSE_REASON = 'document-restored'

export class YjsRuntime {
  #persistenceInitialized = false
  #snapshotTimer: ReturnType<typeof setInterval> | null = null
  #persistenceFlushTimer: ReturnType<typeof setInterval> | null = null
  #config: YjsRuntimeConfig
  #repos: YjsRepositorySet
  #initializedDocs = new Set<string>()
  #initializingDocs = new Map<string, Promise<void>>()
  #dirtyDocs = new Set<string>()
  #documentEpochs = new Map<string, number>()
  #docEpochs = new WeakMap<Y.Doc, number>()

  constructor(repos: YjsRepositorySet, config: YjsRuntimeConfig) {
    this.#repos = repos
    this.#config = config
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
        this.#dirtyDocs.delete(documentName)
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
    const flushed = new Set<string>(this.#dirtyDocs)
    const dirtyDocumentNames = [...this.#dirtyDocs]
    this.#dirtyDocs.clear()

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

  startSnapshotTimer(): void {
    this.#ensurePersistenceInitialized()
    if (this.#snapshotTimer || this.#config.versionSnapshotIntervalMs <= 0) return

    this.#snapshotTimer = setInterval(async () => {
      for (const [documentName, doc] of docs) {
        if (doc.conns.size === 0) continue

        try {
          await this.#insertSnapshot(documentName, doc)
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

  evictLiveDocument(
    documentName: string,
    options: { closeCode?: number; closeReason?: string } = {}
  ): void {
    const liveDoc = docs.get(documentName)
    if (!liveDoc) return

    for (const conn of liveDoc.conns.keys()) {
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
    this.#dirtyDocs.delete(documentName)
    this.#documentEpochs.delete(documentName)
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

  async #flushDirtyDocuments(): Promise<void> {
    if (this.#dirtyDocs.size === 0) return

    const dirtyDocumentNames = [...this.#dirtyDocs]
    this.#dirtyDocs.clear()

    await Promise.all(
      dirtyDocumentNames.map(async (documentName) => {
        const doc = docs.get(documentName)
        if (!doc) return

        try {
          await this.#persistDocumentState(documentName, doc)
        } catch (error) {
          console.error(`Failed to persist Yjs document ${documentName}:`, error)
          this.#dirtyDocs.add(documentName)
        }
      })
    )
  }

  async #persistDocumentState(documentName: string, doc: Y.Doc): Promise<void> {
    if (!this.#isCurrentDocumentInstance(documentName, doc)) return

    const state = Y.encodeStateAsUpdate(doc)
    const buffer = Buffer.from(state)

    await this.#repos.yjsDocuments.set(documentName, buffer)
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

      const data = await this.#repos.yjsDocuments.getPersisted(documentName)

      if (data) {
        Y.applyUpdate(doc, new Uint8Array(data))
      } else {
        await this.#createAndPersistDefaultContent(documentName, doc)
      }

      doc.on('update', () => {
        if (!this.#isCurrentDocumentInstance(documentName, doc)) return
        this.#dirtyDocs.add(documentName)
      })

      doc.on('destroy', () => {
        this.#dirtyDocs.delete(documentName)
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

export function createYjsRuntime(repos: YjsRepositorySet, config: YjsRuntimeConfig): YjsRuntime {
  return new YjsRuntime(repos, config)
}
