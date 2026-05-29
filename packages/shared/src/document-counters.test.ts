import { describe, expect, test } from 'bun:test'
import { computeDocumentCounters } from './document-counters.js'
import type { JsonObject } from './json.js'

function makeDoc(...paragraphs: string[]): JsonObject {
  return {
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  }
}

describe('computeDocumentCounters', () => {
  test('empty document returns zeros', () => {
    const result = computeDocumentCounters({ type: 'doc', content: [] })
    expect(result.wordCount).toBe(0)
    expect(result.charCount).toBe(0)
    expect(result.charCountNoSpaces).toBe(0)
  })

  test('counts words, chars, and chars without spaces', () => {
    const result = computeDocumentCounters(makeDoc('Hello world'))
    expect(result.wordCount).toBe(2)
    expect(result.charCount).toBe(11)
    expect(result.charCountNoSpaces).toBe(10)
  })

  test('handles multiple paragraphs', () => {
    const result = computeDocumentCounters(makeDoc('First paragraph.', 'Second paragraph.'))
    expect(result.wordCount).toBe(4)
    expect(result.charCount).toBe(34)
    expect(result.charCountNoSpaces).toBe(31)
  })

  test('does not merge words across block boundaries', () => {
    const result = computeDocumentCounters(makeDoc('Hello', 'world'))
    expect(result.wordCount).toBe(2)
    expect(result.charCount).toBe(11)
    expect(result.charCountNoSpaces).toBe(10)
  })

  test('handles punctuation and extra spaces', () => {
    const result = computeDocumentCounters(makeDoc('  Hello,   world!  '))
    expect(result.wordCount).toBe(2)
    expect(result.charCount).toBe(19)
    expect(result.charCountNoSpaces).toBe(12)
  })

  test('handles nested content (headings, lists)', () => {
    const doc: JsonObject = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Title' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: ' ' }],
        },
        {
          type: 'bullet_list',
          content: [
            {
              type: 'list_item',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Item one' }],
                },
              ],
            },
            {
              type: 'list_item',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: ' ' },
                    { type: 'text', text: 'Item two' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const result = computeDocumentCounters(doc)
    expect(result.wordCount).toBe(5)
    expect(result.charCount).toBe(26)
    expect(result.charCountNoSpaces).toBe(19)
  })

  test('handles hard breaks as newlines', () => {
    const doc: JsonObject = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Line one' },
            { type: 'hard_break' },
            { type: 'text', text: 'Line two' },
          ],
        },
      ],
    }
    const result = computeDocumentCounters(doc)
    expect(result.wordCount).toBe(4)
    expect(result.charCount).toBe(17)
    expect(result.charCountNoSpaces).toBe(14)
  })

  test('handles empty text nodes gracefully', () => {
    const doc: JsonObject = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '' },
            { type: 'text', text: 'word' },
            { type: 'text', text: '' },
          ],
        },
      ],
    }
    const result = computeDocumentCounters(doc)
    expect(result.wordCount).toBe(1)
    expect(result.charCount).toBe(4)
    expect(result.charCountNoSpaces).toBe(4)
  })
})
