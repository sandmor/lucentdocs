import { describe, expect, test } from 'bun:test'
import { ensureBlockIds, type JsonObject } from '@lucentdocs/shared'
import { mergeEditedManuscript } from './document-edit-merge.js'

function readBlockId(node: JsonObject | undefined): string | null {
  const attrs = node?.attrs
  if (typeof attrs !== 'object' || attrs === null || Array.isArray(attrs)) return null
  const record = attrs as JsonObject
  const id = record.id
  return typeof id === 'string' ? id : null
}

function readDocContent(doc: JsonObject): JsonObject[] {
  if (!Array.isArray(doc.content)) return []
  return doc.content.filter(
    (child): child is JsonObject =>
      typeof child === 'object' && child !== null && !Array.isArray(child)
  )
}

const BLOCK_ONE = 'block-one'
const BLOCK_TWO = 'block-two'
const MARKER_ONE = 'marker-one'

function makeDoc() {
  return ensureBlockIds({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { id: BLOCK_ONE },
        content: [{ type: 'text', text: 'Hello world.' }],
      },
      {
        type: 'note_marker',
        attrs: { id: MARKER_ONE },
      },
      {
        type: 'paragraph',
        attrs: { id: BLOCK_TWO },
        content: [{ type: 'text', text: 'Second paragraph.' }],
      },
    ],
  })
}

describe('mergeEditedManuscript', () => {
  test('preserves note_marker nodes and block ids when editing manuscript text', () => {
    const original = makeDoc()
    const edited = 'Hello universe.\n\nSecond paragraph.'

    const merged = mergeEditedManuscript(original, edited, {
      blockAnchoredIds: new Set(),
      markerAnchoredIds: new Set([MARKER_ONE]),
    })

    const content = readDocContent(merged.doc)
    const types = content.map((child) => child.type)
    expect(types).toEqual(['paragraph', 'note_marker', 'paragraph'])

    const first = content[0]
    const marker = content[1]
    const second = content[2]
    expect(readBlockId(first)).toBe(BLOCK_ONE)
    expect(readBlockId(marker)).toBe(MARKER_ONE)
    expect(readBlockId(second)).toBe(BLOCK_TWO)
  })

  test('warns when block-anchored notes may be orphaned', () => {
    const original = makeDoc()
    const edited = 'Only one paragraph remains.'

    const merged = mergeEditedManuscript(original, edited, {
      blockAnchoredIds: new Set([BLOCK_TWO]),
      markerAnchoredIds: new Set(),
    })

    expect(merged.warnings.some((warning) => warning.code === 'orphaned_block_notes')).toBe(true)
  })

  test('rejects edits that would drop marker nodes still tied to author notes', () => {
    const original = ensureBlockIds({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: BLOCK_ONE },
          content: [{ type: 'text', text: 'First paragraph.' }],
        },
        {
          type: 'paragraph',
          attrs: { id: BLOCK_TWO },
          content: [{ type: 'text', text: 'Second paragraph.' }],
        },
        {
          type: 'note_marker',
          attrs: { id: MARKER_ONE },
        },
      ],
    })
    const edited = 'Only one paragraph remains.'

    expect(() =>
      mergeEditedManuscript(original, edited, {
        blockAnchoredIds: new Set(),
        markerAnchoredIds: new Set([MARKER_ONE]),
      })
    ).toThrow(/note marker anchors/)
  })
})
