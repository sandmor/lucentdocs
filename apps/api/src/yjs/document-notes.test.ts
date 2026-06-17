import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { prosemirrorJSONToYDoc } from 'y-prosemirror'
import { schema, type DocumentNoteRecord } from '@lucentdocs/shared'
import { createTestAdapter, type TestAdapter } from '../testing/factory.js'
import { createYjsRuntime, type YjsRuntime } from './runtime.js'
import type { DocumentsService } from '../core/services/documents.service.js'
import { hydrateNotesMap, notesMapToRecords } from './document-notes.js'
import { docs } from '@y/websocket-server/utils'

const BLOCK_ID = 'block-1'

const makeDoc = (text: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: BLOCK_ID },
      content: [{ type: 'text', text }],
    },
  ],
})

const makeNoteRecord = (
  overrides: Partial<DocumentNoteRecord> & Pick<DocumentNoteRecord, 'documentId'>
): DocumentNoteRecord => ({
  id: 'note-1',
  blockId: BLOCK_ID,
  placement: 'about',
  content: JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'remember this' }] }],
  }),
  authorUserId: 'user-1',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
})

describe('document notes integration', () => {
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

  afterEach(() => {
    yjsRuntime.shutdown()
    void adapter.adapter.engine.close()
  })

  test('snapshot restore rolls back bundled notes with document content', async () => {
    const doc = await documentsService.create('notes-restore.md')

    await yjsRuntime.replaceDocumentBundle(doc.id, {
      doc: makeDoc('before notes'),
      notes: [
        {
          id: 'note-1',
          blockId: BLOCK_ID,
          placement: 'about',
          content: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'remember this' }] }],
          },
          authorUserId: 'user-1',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    const snapshot = await documentsService.createSnapshot(doc.id)
    expect(snapshot).toBeTruthy()

    await yjsRuntime.replaceDocumentBundle(doc.id, {
      doc: makeDoc('after notes'),
      notes: [],
    })

    await documentsService.restoreToSnapshot(doc.id, snapshot!.id)

    const notes = await adapter.repositories.documentNotes.listByDocumentId(doc.id)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.id).toBe('note-1')
    expect(notes[0]?.content).toContain('remember this')
    expect(notes[0]?.authorUserId).toBe('user-1')

    const content = await documentsService.getContent(doc.id)
    expect(content).toContain('before notes')
  })

  test('flush persists live notes map to document_notes', async () => {
    const doc = await documentsService.create('notes-persist.md')
    await yjsRuntime.ensureDocumentLoaded(doc.id)
    const liveDoc = docs.get(doc.id)!
    hydrateNotesMap(liveDoc, [
      makeNoteRecord({
        id: 'note-persist',
        documentId: doc.id,
        blockId: 'blk-persist',
        content: JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'saved note' }] }],
        }),
        authorUserId: 'local',
      }),
    ])

    await yjsRuntime.flushAllDocumentStates()

    const rows = await adapter.repositories.documentNotes.listByDocumentId(doc.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.content).toContain('saved note')
    expect(rows[0]?.authorUserId).toBe('local')
  })

  test('notes map is separate from main prosemirror export', () => {
    const ydoc = prosemirrorJSONToYDoc(schema, makeDoc('export me'))
    hydrateNotesMap(ydoc, [
      makeNoteRecord({
        documentId: 'doc-1',
        id: 'hidden-note',
        content: JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'secret note' }] }],
        }),
      }),
    ])

    const exported = JSON.stringify(ydoc.getXmlFragment('prosemirror').toJSON())
    expect(exported).toContain('export me')
    expect(exported).not.toContain('secret note')
    expect(notesMapToRecords('doc-1', ydoc)).toHaveLength(1)
    ydoc.destroy()
  })
})
