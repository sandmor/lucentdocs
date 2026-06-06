import { describe, expect, test } from 'bun:test'
import { schema } from './schema.js'
import { gapBreaksZoneSegmentChain, hasMeaningfulGap } from './ai-zone-utils.js'

function createZoneNode(zoneId: string, sessionId: string, content: string) {
  return schema.nodes.ai_zone.create(
    {
      id: zoneId,
      streaming: false,
      sessionId,
      originalSlice: null,
    },
    content.length > 0 ? [schema.text(content)] : []
  )
}

describe('gapBreaksZoneSegmentChain', () => {
  test('does not break across a code block between same-id zone segments', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('Before '),
        createZoneNode('zone_a', 'session_a', 'intro'),
      ]),
      schema.nodes.code_block.create({ language: 'ts' }, [schema.text('const x = 1')]),
      schema.nodes.paragraph.create(null, [createZoneNode('zone_a', 'session_a', 'outro')]),
    ])

    let firstZoneTo = 0
    let secondZoneFrom = 0
    doc.descendants((node, pos) => {
      if (node.type !== schema.nodes.ai_zone) return true
      if (firstZoneTo === 0) {
        firstZoneTo = pos + node.nodeSize
        return false
      }
      secondZoneFrom = pos
      return false
    })

    expect(hasMeaningfulGap(doc, firstZoneTo, secondZoneFrom)).toBe(true)
    expect(gapBreaksZoneSegmentChain(doc, firstZoneTo, secondZoneFrom)).toBe(false)
  })

  test('breaks when non-zone paragraph text sits between same-id zone segments', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('Before '),
        createZoneNode('zone_a', 'session_a', 'intro'),
        schema.text(' edited gap '),
        createZoneNode('zone_a', 'session_a', 'outro'),
      ]),
    ])

    let firstZoneTo = 0
    let secondZoneFrom = 0
    doc.descendants((node, pos) => {
      if (node.type !== schema.nodes.ai_zone) return true
      if (firstZoneTo === 0) {
        firstZoneTo = pos + node.nodeSize
        return false
      }
      secondZoneFrom = pos
      return false
    })

    expect(gapBreaksZoneSegmentChain(doc, firstZoneTo, secondZoneFrom)).toBe(true)
  })
})
