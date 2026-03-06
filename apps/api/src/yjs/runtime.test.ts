import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { docs } from '@y/websocket-server/utils'
import * as Y from 'yjs'
import { prosemirrorJSONToYDoc } from 'y-prosemirror'
import { schema } from '@lucentdocs/shared'
import { createYjsRuntime, type YjsRuntime } from './runtime.js'
import { createSqliteAdapter, type SqliteAdapter } from '../infrastructure/sqlite/factory.js'
import {
  createDocumentsService,
  type DocumentsService,
} from '../core/services/documents.service.js'

const makeDoc = (text: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text }],
    },
  ],
})

describe('YjsRuntime', () => {
  let adapter: SqliteAdapter
  let yjsRuntime: YjsRuntime
  let documentsService: DocumentsService

  beforeEach(() => {
    adapter = createSqliteAdapter(':memory:')
    yjsRuntime = createYjsRuntime(
      {
        yjsDocuments: adapter.repositories.yjsDocuments,
        versionSnapshots: adapter.repositories.versionSnapshots,
      },
      { persistenceFlushIntervalMs: 1000, versionSnapshotIntervalMs: 0 }
    )
    yjsRuntime.initialize()
    documentsService = createDocumentsService(adapter.repositories, adapter.transaction)
  })

  afterEach(() => {
    yjsRuntime.shutdown()
    adapter.connection.close()
  })

  test('flushes pending in-memory updates so content survives restart', async () => {
    const doc = await documentsService.create('test.md')
    expect(doc).toBeTruthy()

    await yjsRuntime.ensureDocumentLoaded(doc.id)
    const liveDoc = docs.get(doc.id)
    expect(liveDoc).toBeTruthy()

    const replacement = prosemirrorJSONToYDoc(schema, makeDoc('persisted'))
    const update = Y.encodeStateAsUpdate(replacement)
    replacement.destroy()

    Y.applyUpdate(liveDoc!, update)

    await yjsRuntime.flushAllDocumentStates()

    liveDoc!.destroy()
    docs.delete(doc.id)

    const content = await documentsService.getContent(doc.id)
    expect(content).toBeTruthy()
    const parsed = JSON.parse(content)
    expect(JSON.stringify(parsed)).toContain('persisted')
  })

  test('initialization is idempotent for new docs', async () => {
    const doc = await documentsService.create('test-idempotent.md')

    await Promise.all([
      yjsRuntime.ensureDocumentLoaded(doc.id),
      yjsRuntime.ensureDocumentLoaded(doc.id),
    ])

    const content = await documentsService.getContent(doc.id)
    expect(content).toBeTruthy()

    const parsed = JSON.parse(content) as { content?: Array<{ type?: string }> }
    expect(Array.isArray(parsed.content)).toBe(true)
    expect(parsed.content?.length).toBe(1)
    expect(parsed.content?.[0]?.type).toBe('paragraph')
  })

  test('document content persists after flush', async () => {
    const doc = await documentsService.create('persist-test.md')

    await yjsRuntime.ensureDocumentLoaded(doc.id)
    await yjsRuntime.flushAllDocumentStates()

    const content = await documentsService.getContent(doc.id)
    expect(content).toBeTruthy()
  })

  test('loads persisted state on first ensureDocumentLoaded call', async () => {
    const doc = await documentsService.create('persisted-load.md')

    await yjsRuntime.replaceDocument(doc.id, makeDoc('persisted-before-load'))
    await yjsRuntime.ensureDocumentLoaded(doc.id)

    const content = await documentsService.getContent(doc.id)
    expect(content).toContain('persisted-before-load')
  })
})

describe('DocumentsService YJS operations', () => {
  let adapter: SqliteAdapter
  let yjsRuntime: YjsRuntime
  let documentsService: DocumentsService

  beforeEach(() => {
    adapter = createSqliteAdapter(':memory:')
    yjsRuntime = createYjsRuntime(
      {
        yjsDocuments: adapter.repositories.yjsDocuments,
        versionSnapshots: adapter.repositories.versionSnapshots,
      },
      { persistenceFlushIntervalMs: 1000, versionSnapshotIntervalMs: 0 }
    )
    yjsRuntime.initialize()
    documentsService = createDocumentsService(adapter.repositories, adapter.transaction)
  })

  afterEach(() => {
    yjsRuntime.shutdown()
    adapter.connection.close()
  })

  test('getContent returns default content for new document', async () => {
    const doc = await documentsService.create('new-doc.md')
    const content = await documentsService.getContent(doc.id)

    expect(content).toBeTruthy()
    const parsed = JSON.parse(content)
    expect(parsed).toHaveProperty('type')
    expect(parsed.type).toBe('doc')
  })

  test('createSnapshot creates snapshot from YJS data', async () => {
    const doc = await documentsService.create('snapshot-test.md')

    const snapshot = await documentsService.createSnapshot(doc.id)
    expect(snapshot).toBeTruthy()
    expect(snapshot!.documentId).toBe(doc.id)
  })

  test('getContent reads latest live Yjs state before persistence flush', async () => {
    const doc = await documentsService.create('live-content-test.md')

    await yjsRuntime.ensureDocumentLoaded(doc.id)
    const liveDoc = docs.get(doc.id)
    expect(liveDoc).toBeTruthy()

    const replacement = prosemirrorJSONToYDoc(schema, makeDoc('live-before-flush'))
    const update = Y.encodeStateAsUpdate(replacement)
    replacement.destroy()
    Y.applyUpdate(liveDoc!, update)

    const content = await documentsService.getContent(doc.id)
    expect(content).toContain('live-before-flush')
  })

  test('createSnapshot captures latest live Yjs state before persistence flush', async () => {
    const doc = await documentsService.create('live-snapshot-test.md')

    await yjsRuntime.ensureDocumentLoaded(doc.id)
    const liveDoc = docs.get(doc.id)
    expect(liveDoc).toBeTruthy()

    const replacement = prosemirrorJSONToYDoc(schema, makeDoc('snapshot-live-before-flush'))
    const update = Y.encodeStateAsUpdate(replacement)
    replacement.destroy()
    Y.applyUpdate(liveDoc!, update)

    const snapshot = await documentsService.createSnapshot(doc.id)
    expect(snapshot).toBeTruthy()

    const persistedSnapshot = await adapter.repositories.versionSnapshots.findById(snapshot!.id)
    expect(persistedSnapshot).toBeTruthy()
    expect(persistedSnapshot!.content).toContain('snapshot-live-before-flush')
  })

  test('restoreToSnapshot restores content', async () => {
    const doc = await documentsService.create('restore-test.md')

    const snapshot1 = await documentsService.createSnapshot(doc.id)
    expect(snapshot1).toBeTruthy()

    const restored = await documentsService.restoreToSnapshot(doc.id, snapshot1!.id)
    expect(restored).toBeTruthy()
    expect(restored!.id).toBe(doc.id)
  })
})
