import { describe, expect, test } from 'bun:test'
import { buildEmbeddingChunks } from './chunking.js'

describe('buildEmbeddingChunks', () => {
  test('returns empty array for empty string', () => {
    const chunks = buildEmbeddingChunks('', {
      type: 'sliding_window',
      properties: {
        level: 'character',
        windowSize: 4,
        stride: 2,
      },
    })

    expect(chunks).toEqual([])
  })

  test('returns empty array for whitespace-only input', () => {
    const chunks = buildEmbeddingChunks('   \t\n  ', {
      type: 'sliding_window',
      properties: {
        level: 'character',
        windowSize: 10,
        stride: 5,
      },
    })

    expect(chunks).toEqual([])
  })

  test('returns empty array for unicode whitespace-only input', () => {
    const chunks = buildEmbeddingChunks('\u00A0\u2000\u2001\u2002', {
      type: 'sliding_window',
      properties: {
        level: 'character',
        windowSize: 10,
        stride: 5,
      },
    })

    expect(chunks).toEqual([])
  })

  test('returns empty array for whole document with whitespace-only input', () => {
    const chunks = buildEmbeddingChunks('   ', {
      type: 'whole_document',
      properties: {},
    })

    expect(chunks).toEqual([])
  })

  test('keeps character-level chunking unicode-aware', () => {
    const chunks = buildEmbeddingChunks('A😀BCDEFG', {
      type: 'sliding_window',
      properties: {
        level: 'character',
        windowSize: 4,
        stride: 2,
      },
    })

    expect(chunks).toEqual([
      { ordinal: 0, start: 0, end: 4, text: 'A😀BC' },
      { ordinal: 1, start: 2, end: 6, text: 'BCDE' },
      { ordinal: 2, start: 4, end: 8, text: 'DEFG' },
    ])
  })

  test('slides across sentence windows with overlap', () => {
    const chunks = buildEmbeddingChunks('Alpha. Beta. Gamma.', {
      type: 'sliding_window',
      properties: {
        level: 'sentence',
        windowSize: 2,
        stride: 1,
        minUnitChars: 1,
        maxUnitChars: 100,
      },
    })

    expect(chunks.map((chunk) => chunk.text)).toEqual(['Alpha. Beta. ', 'Beta. Gamma.'])
  })

  test('merges short sentences to satisfy minUnitChars per unit', () => {
    const chunks = buildEmbeddingChunks('One. Another sentence.', {
      type: 'sliding_window',
      properties: {
        level: 'sentence',
        windowSize: 1,
        stride: 1,
        minUnitChars: 10,
        maxUnitChars: 100,
      },
    })

    expect(chunks.map((chunk) => chunk.text)).toEqual(['One. Another sentence.'])
  })

  test('slides across paragraph windows with overlap', () => {
    const first = 'Paragraph one.'
    const second = 'Paragraph two.'
    const third = 'Paragraph three.'
    const fourth = 'Paragraph four.'

    const chunks = buildEmbeddingChunks(`${first}\n\n${second}\n\n${third}\n\n${fourth}`, {
      type: 'sliding_window',
      properties: {
        level: 'paragraph',
        windowSize: 3,
        stride: 2,
        minUnitChars: 1,
        maxUnitChars: 500,
      },
    })

    expect(chunks.map((chunk) => chunk.text)).toEqual([
      `${first}\n\n${second}\n\n${third}`,
      `${third}\n\n${fourth}`,
    ])
  })

  test('splits oversized paragraphs at sentence boundaries', () => {
    const sentence1 = 'First sentence here. '
    const sentence2 = 'Second sentence here. '
    const sentence3 = 'Third sentence here.'
    const paragraph = sentence1 + sentence2 + sentence3

    const chunks = buildEmbeddingChunks(paragraph + '\n\nAnother paragraph.', {
      type: 'sliding_window',
      properties: {
        level: 'paragraph',
        windowSize: 1,
        stride: 1,
        minUnitChars: 1,
        maxUnitChars: 40,
      },
    })

    expect(chunks.length).toBe(4)
    expect(chunks[0]?.text).toBe(sentence1)
    expect(chunks[1]?.text).toBe(sentence2)
    expect(chunks[2]?.text).toBe(sentence3)
    expect(chunks[3]?.text).toBe('Another paragraph.')
  })

  test('splits oversized sentences by graphemes when no sentence boundary', () => {
    const longSentence = 'x'.repeat(100)
    const chunks = buildEmbeddingChunks(longSentence + '. Another sentence.', {
      type: 'sliding_window',
      properties: {
        level: 'sentence',
        windowSize: 1,
        stride: 1,
        minUnitChars: 1,
        maxUnitChars: 50,
      },
    })

    expect(chunks[0]?.text.length).toBe(50)
    expect(chunks[0]?.text).toBe('x'.repeat(50))
    expect(chunks[1]?.text.length).toBe(50)
    expect(chunks[1]?.text).toBe('x'.repeat(50))
  })

  test('merges multiple short sentences until minUnitChars satisfied', () => {
    const chunks = buildEmbeddingChunks('A. B. C. D. E.', {
      type: 'sliding_window',
      properties: {
        level: 'sentence',
        windowSize: 1,
        stride: 1,
        minUnitChars: 10,
        maxUnitChars: 100,
      },
    })

    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.text).toBe('A. B. C. D. ')
    expect(chunks[1]?.text).toBe('E.')
  })

  test('accepts last short unit when no more units to merge', () => {
    const chunks = buildEmbeddingChunks('Short. Long enough sentence here.', {
      type: 'sliding_window',
      properties: {
        level: 'sentence',
        windowSize: 1,
        stride: 1,
        minUnitChars: 20,
        maxUnitChars: 100,
      },
    })

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).toBe('Short. Long enough sentence here.')
  })

  test('handles ZWJ sequences as single graphemes', () => {
    const family = '👨‍👩‍👧‍👦'
    const chunks = buildEmbeddingChunks(`A${family}BC`, {
      type: 'sliding_window',
      properties: {
        level: 'character',
        windowSize: 2,
        stride: 1,
      },
    })

    expect(chunks).toEqual([
      { ordinal: 0, start: 0, end: 2, text: `A${family}` },
      { ordinal: 1, start: 1, end: 3, text: `${family}B` },
      { ordinal: 2, start: 2, end: 4, text: 'BC' },
    ])
  })

  test('handles combining characters as single graphemes', () => {
    const eWithAcute = 'e\u0301'
    const chunks = buildEmbeddingChunks(`A${eWithAcute}B`, {
      type: 'sliding_window',
      properties: {
        level: 'character',
        windowSize: 2,
        stride: 1,
      },
    })

    expect(chunks).toEqual([
      { ordinal: 0, start: 0, end: 2, text: `A${eWithAcute}` },
      { ordinal: 1, start: 1, end: 3, text: `${eWithAcute}B` },
    ])
  })

  test('handles regional indicator sequences (flag emoji) as single graphemes', () => {
    const usFlag = '🇺🇸'
    const chunks = buildEmbeddingChunks(`${usFlag}AB`, {
      type: 'sliding_window',
      properties: {
        level: 'character',
        windowSize: 2,
        stride: 1,
      },
    })

    expect(chunks).toEqual([
      { ordinal: 0, start: 0, end: 2, text: `${usFlag}A` },
      { ordinal: 1, start: 1, end: 3, text: 'AB' },
    ])
  })

  test('preserves tabs and newlines', () => {
    const chunks = buildEmbeddingChunks('A\tB\nC', {
      type: 'sliding_window',
      properties: {
        level: 'character',
        windowSize: 10,
        stride: 5,
      },
    })

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).toBe('A\tB\nC')
  })

  test('preserves leading and trailing whitespace in stored chunk text', () => {
    const chunks = buildEmbeddingChunks('  Alpha  ', {
      type: 'whole_document',
      properties: {},
    })

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).toBe('  Alpha  ')
  })

  test('splits oversized paragraphs at sentence boundaries with multi-code-unit graphemes', () => {
    const chunks = buildEmbeddingChunks('Hello 👋 world. Second sentence here. Third one.', {
      type: 'sliding_window',
      properties: {
        level: 'paragraph',
        windowSize: 1,
        stride: 1,
        minUnitChars: 1,
        maxUnitChars: 25,
      },
    })

    expect(chunks.map((c) => c.text)).toEqual([
      'Hello 👋 world. ',
      'Second sentence here. ',
      'Third one.',
    ])
  })
})
