import { describe, expect, test } from 'bun:test'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { schema, type InlineZoneWriteAction } from '@plotline/shared'
import {
  applyInlineZoneWriteActionToDoc,
  getInlineZoneTextFromDoc,
  setInlineZoneStreamingInDoc,
} from './zone-write.js'

function createZoneNode(
  zoneId: string,
  sessionId: string,
  content: string,
  originalSlice: string | null = null
): ProseMirrorNode {
  const aiZoneType = schema.nodes.ai_zone
  const children = content.length > 0 ? [schema.text(content)] : []
  return aiZoneType.create(
    {
      id: zoneId,
      streaming: true,
      sessionId,
      originalSlice,
    },
    children
  )
}

describe('applyInlineZoneWriteActionToDoc', () => {
  test('reads zone text for the active session', () => {
    const zoneId = 'zone-read'
    const sessionId = 'session-read'
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('Before '),
        createZoneNode(zoneId, sessionId, 'alpha'),
        schema.text(' after'),
      ]),
    ])

    const result = getInlineZoneTextFromDoc(doc, sessionId)
    expect(result.zoneFound).toBe(true)
    expect(result.text).toBe('alpha')
  })

  test('returns missing zone text when session is not found', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [schema.text('No AI zone here')]),
    ])

    const result = getInlineZoneTextFromDoc(doc, 'missing-session')
    expect(result.zoneFound).toBe(false)
    expect(result.text).toBe('')
  })

  test('keeps in-paragraph selection edits inline without splitting the paragraph', () => {
    const zoneId = 'zone-selection'
    const sessionId = 'session-selection'
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('the '),
        createZoneNode(zoneId, sessionId, 'house'),
        schema.text(' is blue'),
      ]),
    ])

    const action: InlineZoneWriteAction = {
      type: 'replace_range',
      fromOffset: 0,
      toOffset: Number.MAX_SAFE_INTEGER,
      content: 'home',
    }

    const result = applyInlineZoneWriteActionToDoc(doc, sessionId, action)

    expect(result.zoneFound).toBe(true)
    expect(result.changed).toBe(true)
    expect(result.nextDoc.childCount).toBe(1)
    expect(result.nextDoc.textBetween(0, result.nextDoc.content.size, '\n\n', '\n')).toBe(
      'the home is blue'
    )

    let zoneNodeCount = 0
    result.nextDoc.descendants((node) => {
      if (node.type === schema.nodes.ai_zone) {
        zoneNodeCount += 1
      }
      return true
    })
    expect(zoneNodeCount).toBe(1)
  })

  test('preserves multi-paragraph continuation output', () => {
    const zoneId = 'zone-continuation'
    const sessionId = 'session-continuation'
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('Start '),
        createZoneNode(zoneId, sessionId, ''),
      ]),
    ])

    const action: InlineZoneWriteAction = {
      type: 'replace_range',
      fromOffset: 0,
      toOffset: 0,
      content: 'First paragraph\n\nSecond paragraph',
    }

    const result = applyInlineZoneWriteActionToDoc(doc, sessionId, action)

    expect(result.zoneFound).toBe(true)
    expect(result.changed).toBe(true)
    expect(result.nextDoc.childCount).toBe(2)
    expect(result.nextDoc.textBetween(0, result.nextDoc.content.size, '\n\n', '\n')).toBe(
      'Start First paragraph\n\nSecond paragraph'
    )

    let zoneNodeCount = 0
    result.nextDoc.descendants((node) => {
      if (node.type === schema.nodes.ai_zone) {
        zoneNodeCount += 1
      }
      return true
    })
    expect(zoneNodeCount).toBe(2)
  })

  test('preserves paragraph breaks with progressive full-text continuation updates', () => {
    const zoneId = 'zone-continuation-chunked'
    const sessionId = 'session-continuation-chunked'
    const initialDoc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('Start '),
        createZoneNode(zoneId, sessionId, ''),
      ]),
    ])

    const firstUpdate: InlineZoneWriteAction = {
      type: 'replace_range',
      fromOffset: 0,
      toOffset: Number.MAX_SAFE_INTEGER,
      content: 'First paragraph\n',
    }
    const firstResult = applyInlineZoneWriteActionToDoc(initialDoc, sessionId, firstUpdate)

    expect(firstResult.zoneFound).toBe(true)
    expect(firstResult.changed).toBe(true)

    const secondUpdate: InlineZoneWriteAction = {
      type: 'replace_range',
      fromOffset: 0,
      toOffset: Number.MAX_SAFE_INTEGER,
      content: 'First paragraph\n\nSecond paragraph',
    }
    const secondResult = applyInlineZoneWriteActionToDoc(
      firstResult.nextDoc,
      sessionId,
      secondUpdate
    )

    expect(secondResult.zoneFound).toBe(true)
    expect(secondResult.changed).toBe(true)
    expect(secondResult.nextDoc.childCount).toBe(2)
    expect(
      secondResult.nextDoc.textBetween(0, secondResult.nextDoc.content.size, '\n\n', '\n')
    ).toBe('Start First paragraph\n\nSecond paragraph')
  })

  test('supports multi-paragraph tool-style replacement inside selected text', () => {
    const zoneId = 'zone-selection-multiparagraph'
    const sessionId = 'session-selection-multiparagraph'
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('the '),
        createZoneNode(zoneId, sessionId, 'house'),
        schema.text(' is blue'),
      ]),
    ])

    const action: InlineZoneWriteAction = {
      type: 'replace_range',
      fromOffset: 0,
      toOffset: Number.MAX_SAFE_INTEGER,
      content: 'first paragraph\n\nsecond paragraph',
    }

    const result = applyInlineZoneWriteActionToDoc(doc, sessionId, action)

    expect(result.zoneFound).toBe(true)
    expect(result.changed).toBe(true)
    expect(result.nextDoc.childCount).toBe(2)
    expect(result.nextDoc.textBetween(0, result.nextDoc.content.size, '\n\n', '\n')).toBe(
      'the first paragraph\n\nsecond paragraph is blue'
    )
  })
})

describe('setInlineZoneStreamingInDoc', () => {
  test('updates streaming state for every zone segment in the session', () => {
    const sessionId = 'session-multi-segment'
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [createZoneNode('zone-multi', sessionId, 'First')]),
      schema.nodes.paragraph.create(null, [createZoneNode('zone-multi', sessionId, 'Second')]),
    ])

    const result = setInlineZoneStreamingInDoc(doc, sessionId, false)
    expect(result.zoneFound).toBe(true)
    expect(result.changed).toBe(true)

    const streamingStates: boolean[] = []
    result.nextDoc.descendants((node) => {
      if (node.type === schema.nodes.ai_zone) {
        streamingStates.push(Boolean(node.attrs.streaming))
      }
      return true
    })
    expect(streamingStates).toEqual([false, false])
  })
})
