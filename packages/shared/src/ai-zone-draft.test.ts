import { describe, expect, test } from 'bun:test'
import { schema } from './schema.js'
import { replaceAIZoneTextInDoc } from './ai-zone-draft.js'

function continuationDoc() {
  return schema.nodeFromJSON({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Before ' },
          {
            type: 'ai_zone',
            attrs: {
              id: 'zone_preview',
              streaming: true,
              sessionId: 'session_preview',
              originalSlice: null,
            },
          },
          { type: 'text', text: ' after' },
        ],
      },
    ],
  })
}

describe('replaceAIZoneTextInDoc', () => {
  test('uses the committed slice transform for multi-paragraph continuation drafts', () => {
    const result = replaceAIZoneTextInDoc(
      continuationDoc(),
      'session_preview',
      'first paragraph\n\n## A heading\n\nlast paragraph',
      true
    )

    expect(result.zoneFound).toBe(true)
    expect(result.changed).toBe(true)
    expect(result.nextDoc.textBetween(0, result.nextDoc.content.size, '\n\n')).toBe(
      'Before first paragraph\n\nA heading\n\nlast paragraph after'
    )
    expect(result.nextDoc.childCount).toBe(3)
    expect(result.nextDoc.child(1).type.name).toBe('heading')
  })

  test('keeps generated inline text inside the review zone for normal paragraphs', () => {
    const result = replaceAIZoneTextInDoc(
      continuationDoc(),
      'session_preview',
      '**highlighted** text',
      true
    )
    const paragraph = result.nextDoc.firstChild!
    const zone = paragraph.child(1)

    expect(zone.type.name).toBe('ai_zone')
    expect(zone.attrs.streaming).toBe(true)
    expect(zone.textContent).toBe('highlighted text')
  })
})
