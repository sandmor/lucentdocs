import { describe, expect, test } from 'bun:test'
import {
  parseVersionSnapshotBundle,
  parseVersionSnapshotBundleStrict,
  serializeVersionSnapshotBundle,
} from './document-notes.js'

const makeDoc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

const makeNote = (id: string, authorUserId = 'user-1') => ({
  id,
  blockId: 'block-1',
  placement: 'about' as const,
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  authorUserId,
  createdAt: 1,
  updatedAt: 1,
})

describe('version snapshot bundles', () => {
  test('round-trips bundled doc and notes', () => {
    const bundle = { doc: makeDoc('hello'), notes: [makeNote('n1')] }
    const parsed = parseVersionSnapshotBundleStrict(serializeVersionSnapshotBundle(bundle))

    expect(parsed?.doc).toEqual(bundle.doc)
    expect(parsed?.notes).toEqual([makeNote('n1')])
  })

  test('accepts bare doc snapshots without a notes array', () => {
    const parsed = parseVersionSnapshotBundleStrict(JSON.stringify(makeDoc('hello')))
    expect(parsed?.doc.type).toBe('doc')
    expect(parsed?.notes).toEqual([])
  })

  test('strict parser rejects invalid input; lenient parser falls back to empty doc', () => {
    expect(parseVersionSnapshotBundleStrict('not json')).toBeNull()
    expect(parseVersionSnapshotBundleStrict('{"foo":"bar"}')).toBeNull()
    expect(parseVersionSnapshotBundle('not json').doc.type).toBe('doc')
  })

  test('drops notes missing authorUserId', () => {
    const parsed = parseVersionSnapshotBundle(
      JSON.stringify({
        doc: makeDoc('hello'),
        notes: [
          {
            id: 'invalid',
            blockId: 'block-1',
            placement: 'about',
            content: { type: 'doc', content: [{ type: 'paragraph' }] },
            createdAt: 1,
            updatedAt: 1,
          },
          makeNote('valid'),
        ],
      })
    )

    expect(parsed.notes.map((note) => note.id)).toEqual(['valid'])
  })
})
