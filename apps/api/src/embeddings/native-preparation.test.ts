import { describe, expect, test } from 'bun:test'
import { prepareEmbeddingDocumentsNative } from './native-preparation.js'

function createContentFromText(text: string): string {
  return JSON.stringify({
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: text ? [{ type: 'text', text }] : undefined,
        },
      ],
    },
    aiDraft: null,
  })
}

describe('prepareEmbeddingDocumentsNative', () => {
  test('returns empty chunks for whitespace-only document text', async () => {
    const [prepared] = await prepareEmbeddingDocumentsNative([
      {
        documentId: 'doc-1',
        title: '',
        content: createContentFromText('   '),
        strategy: {
          type: 'whole_document',
          properties: {},
        },
      },
    ])

    expect(prepared?.chunks).toEqual([])
    expect(prepared?.projectionText).toBe('')
  })

  test('keeps character-level chunking unicode-aware', async () => {
    const [prepared] = await prepareEmbeddingDocumentsNative([
      {
        documentId: 'doc-1',
        title: '',
        content: createContentFromText('A😀BCDEFG'),
        strategy: {
          type: 'sliding_window',
          properties: {
            level: 'character',
            windowSize: 4,
            stride: 2,
          },
        },
      },
    ])

    expect(prepared?.chunks).toHaveLength(3)
    expect(
      prepared?.chunks.map(({ ordinal, start, end, text, selectionFrom, selectionTo }) => ({
        ordinal,
        start,
        end,
        text,
        selectionFrom,
        selectionTo,
      }))
    ).toEqual([
      { ordinal: 0, start: 0, end: 4, text: 'A😀BC', selectionFrom: 1, selectionTo: 6 },
      { ordinal: 1, start: 2, end: 6, text: 'BCDE', selectionFrom: 4, selectionTo: 8 },
      { ordinal: 2, start: 4, end: 8, text: 'DEFG', selectionFrom: 6, selectionTo: 10 },
    ])
    expect(prepared?.chunks.every((chunk) => chunk.estimatedTokens > 0)).toBe(true)
  })

  test('trims whole-document chunk text after projection normalization', async () => {
    const [prepared] = await prepareEmbeddingDocumentsNative([
      {
        documentId: 'doc-1',
        title: '',
        content: createContentFromText('  Alpha  '),
        strategy: {
          type: 'whole_document',
          properties: {},
        },
      },
    ])

    expect(prepared?.chunks).toHaveLength(1)
    expect(prepared?.chunks[0]?.text).toBe('Alpha')
    expect(prepared?.chunks[0]?.selectionFrom).toBeNull()
    expect(prepared?.chunks[0]?.selectionTo).toBeNull()
    expect((prepared?.chunks[0]?.estimatedTokens ?? 0) > 0).toBe(true)
  })
})
