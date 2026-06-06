import { describe, expect, test } from 'bun:test'
import {
  getProtectedZoneRangesFromZones,
  getProtectionRangesForZones,
  positionStrictlyInsideZoneContent,
  rangeOverlapsProtectedZone,
  shouldFilterAIZoneDocumentTransaction,
  AI_ZONE_ALLOWED_META,
} from './ai-zone-protection'
import type { AIZone } from './writer-plugin'
import { aiWriterPluginKey, createAIWriterPlugin } from './writer-plugin'
import { schema } from '@lucentdocs/shared'
import { EditorState } from 'prosemirror-state'

function createZone(overrides: Partial<AIZone> & Pick<AIZone, 'id'>): AIZone {
  return {
    nodeFrom: 10,
    nodeTo: 20,
    segments: [{ nodeFrom: 10, nodeTo: 20 }],
    streaming: false,
    sessionId: 'session-1',
    originalSlice: null,
    ...overrides,
  }
}

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

const emptyDoc = schema.node('doc', null, [schema.node('paragraph')])

const noopHandlers = {
  onAccept: () => {},
  onReject: () => {},
  onCancelAI: () => {},
}

function createMultiSegmentZoneDoc() {
  return schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, [
      schema.text('Before '),
      createZoneNode('zone-a', 'session-1', 'intro'),
    ]),
    schema.nodes.code_block.create({ language: 'ts' }, [schema.text('const x = 1')]),
    schema.nodes.paragraph.create(null, [
      createZoneNode('zone-a', 'session-1', 'outro'),
    ]),
  ])
}

describe('getProtectionRangesForZones', () => {
  test('uses per-segment ranges instead of the logical envelope', () => {
    const doc = createMultiSegmentZoneDoc()
    const state = EditorState.create({
      schema,
      doc,
      plugins: [createAIWriterPlugin(noopHandlers)],
    })

    const zone = aiWriterPluginKey.getState(state)?.zones[0]!
    expect(aiWriterPluginKey.getState(state)?.zones).toHaveLength(1)
    expect(zone.segments).toHaveLength(2)
    expect(zone.nodeFrom).toBeLessThan(zone.segments[0]!.nodeTo)
    expect(zone.nodeTo).toBeGreaterThan(zone.segments[0]!.nodeTo)

    const ranges = getProtectionRangesForZones(state.doc, [zone])
    const segmentOne = zone.segments[0]!
    const afterSegmentOne = segmentOne.nodeTo

    expect(positionStrictlyInsideZoneContent(afterSegmentOne, zone)).toBe(false)
    expect(rangeOverlapsProtectedZone(ranges, afterSegmentOne, afterSegmentOne + 1)).toBe(false)

    const insideSegmentOne = segmentOne.nodeFrom + 1
    expect(positionStrictlyInsideZoneContent(insideSegmentOne, zone)).toBe(true)
    expect(rangeOverlapsProtectedZone(ranges, insideSegmentOne, insideSegmentOne + 1)).toBe(true)
  })

  test('protects structural gap blocks between linked segments', () => {
    const state = EditorState.create({
      schema,
      doc: createMultiSegmentZoneDoc(),
      plugins: [createAIWriterPlugin(noopHandlers)],
    })
    const zone = aiWriterPluginKey.getState(state)?.zones[0]!
    const ranges = getProtectionRangesForZones(state.doc, [zone])

    let codeBlockFrom = -1
    let codeBlockTo = -1
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'code_block') {
        codeBlockFrom = pos
        codeBlockTo = pos + node.nodeSize
      }
      return true
    })

    expect(codeBlockFrom).toBeGreaterThan(0)
    expect(rangeOverlapsProtectedZone(ranges, codeBlockFrom + 1, codeBlockFrom + 2)).toBe(true)
    expect(rangeOverlapsProtectedZone(ranges, codeBlockTo, codeBlockTo + 1)).toBe(false)
  })
})

describe('createAIWriterPlugin zone collection', () => {
  test('merges same-id zone segments across an intervening code block', () => {
    const state = EditorState.create({
      doc: createMultiSegmentZoneDoc(),
      plugins: [createAIWriterPlugin(noopHandlers)],
    })

    const zones = aiWriterPluginKey.getState(state)?.zones ?? []
    expect(zones).toHaveLength(1)
    expect(zones[0]?.segments).toHaveLength(2)
    expect(zones[0]?.nodeFrom).toBeLessThan(zones[0]?.nodeTo ?? 0)
  })

  test('allows insertText immediately after the first segment in a multi-segment zone', () => {
    const plugin = createAIWriterPlugin(noopHandlers)
    const state = EditorState.create({
      doc: createMultiSegmentZoneDoc(),
      plugins: [plugin],
    })
    const zone = aiWriterPluginKey.getState(state)?.zones[0]
    expect(zone).toBeDefined()

    const insertPos = zone!.segments[0]!.nodeTo
    const pluginZones = aiWriterPluginKey.getState(state)?.zones ?? []
    const tr = state.tr.insertText('x', insertPos)

    expect(
      shouldFilterAIZoneDocumentTransaction(
        tr,
        getProtectedZoneRangesFromZones(state.doc, pluginZones)
      )
    ).toBe(false)
    expect(plugin.filterTransaction?.(tr, state)).not.toBe(false)
    expect(zone!.segments).toHaveLength(2)

    const next = state.apply(tr)
    expect(next.doc.textBetween(insertPos, insertPos + 1)).toBe('x')
  })
})

describe('shouldFilterAIZoneDocumentTransaction', () => {
  const ranges = getProtectedZoneRangesFromZones(emptyDoc, [createZone({ id: 'zone-a' })])

  test('allows whitelisted transactions and blocks protected edits', () => {
    const paragraphDoc = schema.node('doc', null, [schema.node('paragraph')])
    const allowedByMeta = EditorState.create({ schema, doc: paragraphDoc })
      .tr.insertText('blocked', 1)
      .setMeta(AI_ZONE_ALLOWED_META, true)
    const allowedByWriter = EditorState.create({ schema, doc: paragraphDoc })
      .tr.insertText('blocked', 1)
      .setMeta(aiWriterPluginKey, { type: 'accept' })

    expect(shouldFilterAIZoneDocumentTransaction(allowedByMeta, ranges)).toBe(false)
    expect(shouldFilterAIZoneDocumentTransaction(allowedByWriter, ranges)).toBe(false)

    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('hello world')]),
    ])
    const blocked = EditorState.create({ schema, doc }).tr.insertText('x', 12)
    expect(shouldFilterAIZoneDocumentTransaction(blocked, ranges)).toBe(true)
  })
})

describe('transactionTouchesProtectedZones', () => {
  test('detects overlap using per-step mapping rather than the full transaction mapping', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('0123456789abcdefghij'),
      ]),
    ])
    const state = EditorState.create({ schema, doc })
    const ranges = [{ from: 15, to: 20 }]

    const tr = state.tr.insertText('x', 1).insertText('y', 18)
    expect(shouldFilterAIZoneDocumentTransaction(tr, ranges)).toBe(true)
  })

  test('ignores earlier steps when a later step only edits outside the protected range', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('0123456789abcdefghij'),
      ]),
    ])
    const state = EditorState.create({ schema, doc })
    const ranges = [{ from: 15, to: 20 }]

    const tr = state.tr.insertText('x', 1).insertText('z', 22)
    expect(shouldFilterAIZoneDocumentTransaction(tr, ranges)).toBe(false)
  })
})
