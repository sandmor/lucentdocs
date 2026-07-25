import { describe, expect, test } from 'bun:test'
import { schema } from '@lucentdocs/shared'
import type { AIBubblePresenceFrame } from './ai-bubble-presence'
import { resolveAIDraftPreviewRanges } from './ai-draft-preview-plugin'

function zone(zoneId: string, sessionId: string) {
  return schema.nodes.ai_zone.create({
    id: zoneId,
    streaming: true,
    sessionId,
    originalSlice: null,
  })
}

function frame(zoneId: string, sessionId: string, text: string): AIBubblePresenceFrame {
  return {
    zoneId,
    sessionId,
    generationId: `generation-${sessionId}`,
    ownerClientId: 1,
    seq: 1,
    text,
    updatedAt: 1,
  }
}

describe('resolveAIDraftPreviewRanges', () => {
  test('renders separate previews for drafts in separate source blocks', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [schema.text('First '), zone('zone-one', 'session-one')]),
      schema.nodes.paragraph.create(null, [
        schema.text('Second '),
        zone('zone-two', 'session-two'),
      ]),
    ])

    const ranges = resolveAIDraftPreviewRanges(doc, [
      frame('zone-one', 'session-one', 'draft one'),
      frame('zone-two', 'session-two', 'draft two'),
    ])

    expect(ranges).toHaveLength(2)
    expect(ranges.map((range) => range.previewDoc.textContent)).toEqual([
      'First draft one',
      'Second draft two',
    ])
  })

  test('composes concurrent drafts that share a paragraph into one preview', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('Before '),
        zone('zone-one', 'session-one'),
        schema.text(' between '),
        zone('zone-two', 'session-two'),
        schema.text(' after'),
      ]),
    ])

    const ranges = resolveAIDraftPreviewRanges(doc, [
      frame('zone-one', 'session-one', 'first paragraph\n\nsecond paragraph'),
      frame('zone-two', 'session-two', 'other draft'),
    ])

    expect(ranges).toHaveLength(1)
    expect(ranges[0]?.zoneIds).toEqual(['zone-one', 'zone-two'])
    expect(ranges[0]?.previewDoc.textBetween(0, ranges[0].previewDoc.content.size, '\n\n')).toBe(
      'Before first paragraph\n\nsecond paragraph between other draft after'
    )
  })
})
