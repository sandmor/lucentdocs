import { docs, getYDoc, setPersistence, setupWSConnection } from '@y/websocket-server/utils'
import * as Y from 'yjs'
import { getDb } from '../db/client.js'
import * as dalVersionSnapshots from '../db/dal/versionSnapshots.js'
import { YJS_CONFIG } from '../config/yjs.js'
import { yDocToProsemirrorJSON, prosemirrorJSONToYDoc } from 'y-prosemirror'
import { createDefaultContent, parseContent, schema, type JsonObject } from '@plotline/shared'
import { nanoid } from 'nanoid'

export { setupWSConnection }

let persistenceInitialized = false
let snapshotTimer: ReturnType<typeof setInterval> | null = null
let persistenceFlushTimer: ReturnType<typeof setInterval> | null = null

const initializedDocs = new Set<string>()
const initializingDocs = new Map<string, Promise<void>>()
const dirtyDocs = new Set<string>()
const documentEpochs = new Map<string, number>()
const docEpochs = new WeakMap<Y.Doc, number>()

export interface PersistedSnapshot {
  id: string
  documentId: string
  content: string
  createdAt: number
}

export const YJS_RESTORE_CLOSE_CODE = 4401
export const YJS_RESTORE_CLOSE_REASON = 'document-restored'

function getDocumentEpoch(documentName: string): number {
  return documentEpochs.get(documentName) ?? 0
}

function getDocEpoch(doc: Y.Doc): number {
  return docEpochs.get(doc) ?? 0
}

function isCurrentDocumentInstance(documentName: string, doc: Y.Doc): boolean {
  return getDocEpoch(doc) === getDocumentEpoch(documentName)
}

function setDocEpoch(documentName: string, doc: Y.Doc): void {
  docEpochs.set(doc, getDocumentEpoch(documentName))
}

function bumpDocumentEpoch(documentName: string): number {
  const nextEpoch = getDocumentEpoch(documentName) + 1
  documentEpochs.set(documentName, nextEpoch)
  return nextEpoch
}

async function persistDocumentState(documentName: string, doc: Y.Doc): Promise<void> {
  if (!isCurrentDocumentInstance(documentName, doc)) return

  const db = await getDb()
  const state = Y.encodeStateAsUpdate(doc)
  const buffer = Buffer.from(state)

  await db.run(
    `INSERT INTO yjs_documents (name, data) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET data = excluded.data`,
    [documentName, buffer]
  )
}

function markDocumentDirty(documentName: string): void {
  dirtyDocs.add(documentName)
}

async function insertSnapshot(documentName: string, doc: Y.Doc): Promise<PersistedSnapshot> {
  const snapshotId = nanoid()
  const createdAt = Date.now()
  const content = JSON.stringify(yDocToProsemirrorJSON(doc))
  await dalVersionSnapshots.insert({
    id: snapshotId,
    documentId: documentName,
    content,
    createdAt,
  })

  return {
    id: snapshotId,
    documentId: documentName,
    content,
    createdAt,
  }
}

async function flushDirtyDocuments(): Promise<void> {
  if (dirtyDocs.size === 0) return

  const dirtyDocumentNames = [...dirtyDocs]
  dirtyDocs.clear()

  await Promise.all(
    dirtyDocumentNames.map(async (documentName) => {
      const doc = docs.get(documentName)
      if (!doc) return

      try {
        await persistDocumentState(documentName, doc)
      } catch (error) {
        console.error(`Failed to persist Yjs document ${documentName}:`, error)
        // Retry on next interval.
        dirtyDocs.add(documentName)
      }
    })
  )
}

function startPersistenceFlushLoop(): void {
  if (persistenceFlushTimer) return

  persistenceFlushTimer = setInterval(() => {
    void flushDirtyDocuments()
  }, YJS_CONFIG.persistenceFlushIntervalMs)

  if (typeof persistenceFlushTimer.unref === 'function') {
    persistenceFlushTimer.unref()
  }
}

export function stopPersistenceFlushLoop(): void {
  if (!persistenceFlushTimer) return

  clearInterval(persistenceFlushTimer)
  persistenceFlushTimer = null
}

export async function flushAllDocumentStates(): Promise<void> {
  ensurePersistenceInitialized()

  const persistOps: Promise<void>[] = []
  const flushed = new Set<string>(dirtyDocs)
  const dirtyDocumentNames = [...dirtyDocs]
  dirtyDocs.clear()

  for (const documentName of dirtyDocumentNames) {
    const doc = docs.get(documentName)
    if (!doc) continue

    persistOps.push(
      persistDocumentState(documentName, doc).catch((error) => {
        console.error(`Failed to flush Yjs document ${documentName}:`, error)
      })
    )
  }

  for (const [documentName, doc] of docs) {
    if (flushed.has(documentName)) continue

    persistOps.push(
      persistDocumentState(documentName, doc).catch((error) => {
        console.error(`Failed to persist Yjs document ${documentName}:`, error)
      })
    )
  }

  await Promise.all(persistOps)
}

async function createAndPersistDefaultContent(documentName: string, doc: Y.Doc): Promise<void> {
  const parsed = parseContent(createDefaultContent())
  const defaultDoc = prosemirrorJSONToYDoc(schema, parsed.doc)
  const update = Y.encodeStateAsUpdate(defaultDoc)
  Y.applyUpdate(doc, update)
  defaultDoc.destroy()

  await persistDocumentState(documentName, doc)
}

async function initializeDocumentState(documentName: string, doc: Y.Doc): Promise<void> {
  if (initializedDocs.has(documentName)) {
    if (isCurrentDocumentInstance(documentName, doc)) return
    throw new Error(`Stale Yjs document instance for ${documentName}`)
  }

  const existingInit = initializingDocs.get(documentName)
  if (existingInit) {
    await existingInit

    if (initializedDocs.has(documentName) && isCurrentDocumentInstance(documentName, doc)) {
      return
    }

    throw new Error(`Stale Yjs document instance for ${documentName}`)
  }

  const initPromise = (async () => {
    setDocEpoch(documentName, doc)

    const db = await getDb()
    const row = await db.get<{ data: Buffer }>('SELECT data FROM yjs_documents WHERE name = ?', [
      documentName,
    ])

    if (row) {
      Y.applyUpdate(doc, new Uint8Array(row.data))
    } else {
      await createAndPersistDefaultContent(documentName, doc)
    }

    doc.on('update', () => {
      if (!isCurrentDocumentInstance(documentName, doc)) return
      markDocumentDirty(documentName)
    })

    doc.on('destroy', () => {
      dirtyDocs.delete(documentName)
      initializedDocs.delete(documentName)
      initializingDocs.delete(documentName)
    })

    initializedDocs.add(documentName)
  })()

  initializingDocs.set(documentName, initPromise)

  try {
    await initPromise
  } finally {
    if (initializingDocs.get(documentName) === initPromise) {
      initializingDocs.delete(documentName)
    }
  }
}

function ensurePersistenceInitialized(): void {
  if (persistenceInitialized) return

  setPersistence({
    provider: null,
    bindState(documentName, doc) {
      void initializeDocumentState(documentName, doc).catch((error) => {
        console.error(`Failed to load Yjs document ${documentName}:`, error)
      })
    },
    async writeState(documentName, doc) {
      dirtyDocs.delete(documentName)
      await persistDocumentState(documentName, doc)
    },
  })

  startPersistenceFlushLoop()
  persistenceInitialized = true
}

export async function ensureDocumentLoaded(documentName: string): Promise<void> {
  ensurePersistenceInitialized()
  const doc = getYDoc(documentName)
  await initializeDocumentState(documentName, doc)
}

export function startSnapshotTimer(): void {
  ensurePersistenceInitialized()
  if (snapshotTimer || YJS_CONFIG.versionSnapshotIntervalMs <= 0) return

  snapshotTimer = setInterval(async () => {
    for (const [documentName, doc] of docs) {
      if (doc.conns.size === 0) continue

      try {
        await insertSnapshot(documentName, doc)
      } catch (error) {
        console.error(`Failed to create snapshot for ${documentName}:`, error)
      }
    }
  }, YJS_CONFIG.versionSnapshotIntervalMs)
}

export function stopSnapshotTimer(): void {
  if (snapshotTimer) {
    clearInterval(snapshotTimer)
    snapshotTimer = null
  }
}

/**
 * Re-read current config values and reconfigure runtime timers without restarting the process.
 */
export function reloadRuntimeConfig(): void {
  if (!persistenceInitialized) return

  stopPersistenceFlushLoop()
  stopSnapshotTimer()
  startPersistenceFlushLoop()
  startSnapshotTimer()
}

export async function getDocumentContent(documentName: string): Promise<string | null> {
  ensurePersistenceInitialized()

  const doc = docs.get(documentName)
  if (doc && isCurrentDocumentInstance(documentName, doc)) {
    const content = yDocToProsemirrorJSON(doc)
    return JSON.stringify(content)
  }

  const db = await getDb()
  const row = await db.get<{ data: Buffer }>('SELECT data FROM yjs_documents WHERE name = ?', [
    documentName,
  ])

  if (!row) return null

  const loadedDoc = new Y.Doc()
  Y.applyUpdate(loadedDoc, new Uint8Array(row.data))
  const content = yDocToProsemirrorJSON(loadedDoc)
  loadedDoc.destroy()

  return JSON.stringify(content)
}

export async function createSnapshot(documentName: string): Promise<PersistedSnapshot | null> {
  ensurePersistenceInitialized()

  await ensureDocumentLoaded(documentName)
  const doc = docs.get(documentName)

  if (!doc || !isCurrentDocumentInstance(documentName, doc)) return null
  return insertSnapshot(documentName, doc)
}

interface EvictLiveDocumentOptions {
  closeCode?: number
  closeReason?: string
}

export function evictLiveDocument(
  documentName: string,
  options: EvictLiveDocumentOptions = {}
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
  initializedDocs.delete(documentName)
  initializingDocs.delete(documentName)
  dirtyDocs.delete(documentName)
}

export async function replaceDocument(
  documentName: string,
  prosemirrorJson: JsonObject,
  options: { evictLive?: boolean; closeCode?: number; closeReason?: string } = {}
): Promise<void> {
  ensurePersistenceInitialized()

  const replacementDoc = prosemirrorJSONToYDoc(schema, prosemirrorJson)
  const replacementState = Y.encodeStateAsUpdate(replacementDoc)
  replacementDoc.destroy()

  const previousEpoch = getDocumentEpoch(documentName)
  bumpDocumentEpoch(documentName)

  const db = await getDb()
  try {
    await db.run(
      `INSERT INTO yjs_documents (name, data) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET data = excluded.data`,
      [documentName, Buffer.from(replacementState)]
    )
  } catch (error) {
    documentEpochs.set(documentName, previousEpoch)
    throw error
  }

  if (options.evictLive ?? true) {
    evictLiveDocument(documentName, {
      closeCode: options.closeCode,
      closeReason: options.closeReason,
    })
  }
}
