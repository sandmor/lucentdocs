import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { docs } from '@y/websocket-server/utils'
import * as Y from 'yjs'
import { yXmlFragmentToProseMirrorRootNode, prosemirrorJSONToYDoc } from 'y-prosemirror'
import { schema } from '@lucentdocs/shared'
import { createYjsRuntime, type YjsRuntime } from './runtime.js'
import { createTestAdapter, type TestAdapter } from '../testing/factory.js'
import type { DocumentsService } from '../core/services/documents.service.js'
import { nanoid } from 'nanoid'
import { hydrateNotesMap, notesMapToRecords } from './document-notes.js'

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
  let adapter: TestAdapter
  let yjsRuntime: YjsRuntime
  let documentsService: DocumentsService

  beforeEach(() => {
    adapter = createTestAdapter()
    yjsRuntime = createYjsRuntime(
      {
        yjsDocuments: adapter.repositories.yjsDocuments,
        versionSnapshots: adapter.repositories.versionSnapshots,
        documentContent: adapter.repositories.documentContent,
        documentNotes: adapter.repositories.documentNotes,
      },
      { persistenceFlushIntervalMs: 1000, versionSnapshotIntervalMs: 0 }
    )
    yjsRuntime.initialize()
    documentsService = adapter.services.documents
  })

  afterEach(async () => {
    await yjsRuntime.shutdown()
    await adapter.adapter.engine.close()
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

  test('clears document notes in the same transform when requested', async () => {
    const doc = await documentsService.create('clear-notes.md')
    await yjsRuntime.ensureDocumentLoaded(doc.id)
    const liveDoc = docs.get(doc.id)
    if (!liveDoc) throw new Error('Expected live Yjs document.')

    hydrateNotesMap(liveDoc, [
      {
        id: 'note-clear',
        documentId: doc.id,
        anchorKind: 'block',
        anchorId: 'block-clear',
        content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
        authorUserId: 'user-1',
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await yjsRuntime.applyProsemirrorTransform(doc.id, {
      clearNotes: true,
      transform: (currentDoc) => ({ changed: true, nextDoc: currentDoc, result: null }),
    })

    expect(notesMapToRecords(doc.id, liveDoc)).toHaveLength(0)
  })

  test('initialization is idempotent for new docs', async () => {
    const doc = await documentsService.create('test-idempotent.md')

    await Promise.all([
      yjsRuntime.ensureDocumentLoaded(doc.id),
      yjsRuntime.ensureDocumentLoaded(doc.id),
    ])
    const firstLiveDoc = docs.get(doc.id)
    await yjsRuntime.ensureDocumentLoaded(doc.id)

    expect(docs.get(doc.id)).toBe(firstLiveDoc)

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
  let adapter: TestAdapter
  let yjsRuntime: YjsRuntime
  let documentsService: DocumentsService

  beforeEach(() => {
    adapter = createTestAdapter()
    yjsRuntime = createYjsRuntime(
      {
        yjsDocuments: adapter.repositories.yjsDocuments,
        versionSnapshots: adapter.repositories.versionSnapshots,
        documentContent: adapter.repositories.documentContent,
        documentNotes: adapter.repositories.documentNotes,
      },
      { persistenceFlushIntervalMs: 1000, versionSnapshotIntervalMs: 0 }
    )
    yjsRuntime.initialize()
    documentsService = adapter.services.documents
  })

  afterEach(async () => {
    await yjsRuntime.shutdown()
    await adapter.adapter.engine.close()
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

  test('canonical document_content wins over stale yjs blob on read and cold load', async () => {
    const doc = await documentsService.create('canonical-priority.md')
    await yjsRuntime.replaceDocumentBundle(doc.id, { doc: makeDoc('canonical-truth'), notes: [] })

    const staleDoc = prosemirrorJSONToYDoc(schema, makeDoc('stale-blob'))
    await adapter.repositories.yjsDocuments.set(
      doc.id,
      Buffer.from(Y.encodeStateAsUpdate(staleDoc))
    )
    staleDoc.destroy()

    const content = await documentsService.getContent(doc.id)
    expect(content).toContain('canonical-truth')
    expect(content).not.toContain('stale-blob')

    yjsRuntime.evictLiveDocument(doc.id)
    await yjsRuntime.ensureDocumentLoaded(doc.id)
    const liveDoc = docs.get(doc.id)!
    const json = yXmlFragmentToProseMirrorRootNode(
      liveDoc.getXmlFragment('prosemirror'),
      schema
    ).toJSON() as {
      content?: Array<{ content?: Array<{ text?: string }> }>
    }
    expect(json.content?.[0]?.content?.[0]?.text).toBe('canonical-truth')
  })

  test('cold reload preserves Yjs identities so reconnecting clients do not duplicate content', async () => {
    const doc = await documentsService.create('reconnect-identities.md')
    await yjsRuntime.replaceDocumentBundle(doc.id, {
      doc: makeDoc('one canonical paragraph'),
      notes: [],
    })
    await yjsRuntime.ensureDocumentLoaded(doc.id)

    const originalServerDoc = docs.get(doc.id)
    if (!originalServerDoc) throw new Error('Expected initial live Yjs document.')

    const reconnectingClient = new Y.Doc()
    Y.applyUpdate(reconnectingClient, Y.encodeStateAsUpdate(originalServerDoc))

    yjsRuntime.evictLiveDocument(doc.id)
    await yjsRuntime.ensureDocumentLoaded(doc.id)

    const restartedServerDoc = docs.get(doc.id)
    if (!restartedServerDoc) throw new Error('Expected reloaded live Yjs document.')

    // Simulate the bidirectional state-vector exchange performed by y-websocket.
    // If the cold server rebuilt canonical JSON under fresh Yjs IDs, this merge
    // would retain both copies of the paragraph.
    Y.applyUpdate(restartedServerDoc, Y.encodeStateAsUpdate(reconnectingClient))
    Y.applyUpdate(reconnectingClient, Y.encodeStateAsUpdate(restartedServerDoc))

    const json = yXmlFragmentToProseMirrorRootNode(
      restartedServerDoc.getXmlFragment('prosemirror'),
      schema
    ).toJSON() as {
      content?: Array<{ content?: Array<{ text?: string }> }>
    }

    expect(json.content).toHaveLength(1)
    expect(json.content?.[0]?.content?.[0]?.text).toBe('one canonical paragraph')

    reconnectingClient.destroy()
  })

  test('epoch bump prevents stale live flush from overwriting canonical restore', async () => {
    const doc = await documentsService.create('restore-race.md')
    await yjsRuntime.ensureDocumentLoaded(doc.id)
    const liveDoc = docs.get(doc.id)!
    const stale = prosemirrorJSONToYDoc(schema, makeDoc('stale-live'))
    Y.applyUpdate(liveDoc, Y.encodeStateAsUpdate(stale))
    stale.destroy()

    await adapter.repositories.documentContent.upsert(doc.id, makeDoc('restored-canonical'))

    yjsRuntime.bumpDocumentEpoch(doc.id)
    await yjsRuntime.flushAllDocumentStates()

    yjsRuntime.evictLiveDocument(doc.id)

    const content = await documentsService.getContent(doc.id)
    expect(content).toContain('restored-canonical')
    expect(content).not.toContain('stale-live')
  })

  test('restoreToSnapshot rejects corrupt snapshot content', async () => {
    const doc = await documentsService.create('corrupt-restore.md')
    await yjsRuntime.replaceDocumentBundle(doc.id, { doc: makeDoc('keep-me'), notes: [] })

    const snapshotId = nanoid()
    await adapter.repositories.versionSnapshots.insert({
      id: snapshotId,
      documentId: doc.id,
      content: 'not valid snapshot json',
      createdAt: Date.now(),
    })

    const restored = await documentsService.restoreToSnapshot(doc.id, snapshotId)
    expect(restored).toBeNull()

    const content = await documentsService.getContent(doc.id)
    expect(content).toContain('keep-me')
  })
})
