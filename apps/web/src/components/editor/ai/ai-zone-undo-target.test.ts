import { describe, expect, test } from 'bun:test'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { EditorState, Plugin, TextSelection } from 'prosemirror-state'
import { schema } from '@lucentdocs/shared'
import { aiWriterPluginKey, type AIZone } from './writer-plugin'
import { resolveSessionUndoTarget } from './ai-zone-undo-target'

function findZoneRange(doc: ProseMirrorNode, zoneId: string): { from: number; to: number } {
  let from = 0
  let to = 0
  doc.descendants((node, pos) => {
    if (node.type === schema.nodes.ai_zone && node.attrs.id === zoneId) {
      from = pos
      to = pos + node.nodeSize
      return false
    }
    return true
  })
  return { from, to }
}

function findZoneSegments(
  doc: ProseMirrorNode,
  zoneId: string
): Array<{ from: number; to: number }> {
  const segments: Array<{ from: number; to: number }> = []
  doc.descendants((node, pos) => {
    if (node.type === schema.nodes.ai_zone && node.attrs.id === zoneId) {
      segments.push({ from: pos, to: pos + node.nodeSize })
    }
    return true
  })
  return segments
}

function createView(docJson: object, selectionPos: number, zoneId = 'zone_a') {
  const doc = schema.nodeFromJSON(docJson)
  const { from, to } = findZoneRange(doc, zoneId)
  const zone: AIZone = {
    id: zoneId,
    nodeFrom: from,
    nodeTo: to,
    segments: [{ nodeFrom: from, nodeTo: to }],
    streaming: false,
    sessionId: 'session_a',
    originalSlice: null,
  }

  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, selectionPos),
    plugins: [
      new Plugin({
        key: aiWriterPluginKey,
        state: {
          init: () => ({
            active: true,
            zoneId,
            sessionId: 'session_a',
            from,
            to,
            streaming: false,
            stuck: false,
            originalSlice: null,
            originalFrom: null,
            originalSelectionFrom: null,
            originalSelectionTo: null,
            zones: [zone],
          }),
          apply: (_tr, value) => value,
        },
      }),
    ],
  })

  return { state } as unknown as EditorView
}

function createMultiSegmentView(docJson: object, selectionPos: number, zoneId = 'zone_a') {
  const doc = schema.nodeFromJSON(docJson)
  const segments = findZoneSegments(doc, zoneId)
  const nodeFrom = segments[0]?.from ?? 0
  const nodeTo = segments[segments.length - 1]?.to ?? 0
  const zone: AIZone = {
    id: zoneId,
    nodeFrom,
    nodeTo,
    segments: segments.map((segment) => ({
      nodeFrom: segment.from,
      nodeTo: segment.to,
    })),
    streaming: false,
    sessionId: 'session_a',
    originalSlice: null,
  }

  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, selectionPos),
    plugins: [
      new Plugin({
        key: aiWriterPluginKey,
        state: {
          init: () => ({
            active: true,
            zoneId,
            sessionId: 'session_a',
            from: nodeFrom,
            to: nodeTo,
            streaming: false,
            stuck: false,
            originalSlice: null,
            originalFrom: null,
            originalSelectionFrom: null,
            originalSelectionTo: null,
            zones: [zone],
          }),
          apply: (_tr, value) => value,
        },
      }),
    ],
  })

  return { state } as unknown as EditorView
}

describe('resolveSessionUndoTarget', () => {
  test('returns null when caret is outside the active zone and controls are not interacting', () => {
    const view = createView(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Before ' },
              {
                type: 'ai_zone',
                attrs: {
                  id: 'zone_a',
                  streaming: false,
                  sessionId: 'session_a',
                  originalSlice: null,
                },
                content: [{ type: 'text', text: 'spark' }],
              },
              { type: 'text', text: ' after' },
            ],
          },
        ],
      },
      2
    )

    const target = resolveSessionUndoTarget(view, {
      isInlineAIControlsInteracting: () => false,
    })

    expect(target).toBeNull()
  })

  test('returns session when caret overlaps the active zone', () => {
    const docJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Before ' },
            {
              type: 'ai_zone',
              attrs: {
                id: 'zone_a',
                streaming: false,
                sessionId: 'session_a',
                originalSlice: null,
              },
              content: [{ type: 'text', text: 'spark' }],
            },
          ],
        },
      ],
    }
    const doc = schema.nodeFromJSON(docJson)
    const { from } = findZoneRange(doc, 'zone_a')
    const view = createView(docJson, from + 2)

    const target = resolveSessionUndoTarget(view, {
      isInlineAIControlsInteracting: () => false,
    })

    expect(target?.sessionId).toBe('session_a')
  })

  test('returns session when inline controls are interacting', () => {
    const view = createView(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Before ' },
              {
                type: 'ai_zone',
                attrs: {
                  id: 'zone_a',
                  streaming: false,
                  sessionId: 'session_a',
                  originalSlice: null,
                },
                content: [{ type: 'text', text: 'spark' }],
              },
            ],
          },
        ],
      },
      2
    )

    const target = resolveSessionUndoTarget(view, {
      isInlineAIControlsInteracting: () => true,
    })

    expect(target?.sessionId).toBe('session_a')
  })

  test('returns session when caret is inside a structural gap within the zone envelope', () => {
    const docJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Before ' },
            {
              type: 'ai_zone',
              attrs: {
                id: 'zone_a',
                streaming: false,
                sessionId: 'session_a',
                originalSlice: null,
              },
              content: [{ type: 'text', text: 'intro' }],
            },
          ],
        },
        {
          type: 'code_block',
          attrs: { language: 'ts' },
          content: [{ type: 'text', text: 'const x = 1' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'ai_zone',
              attrs: {
                id: 'zone_a',
                streaming: false,
                sessionId: 'session_a',
                originalSlice: null,
              },
              content: [{ type: 'text', text: 'outro' }],
            },
          ],
        },
      ],
    }
    const doc = schema.nodeFromJSON(docJson)
    let codeBlockPos = 0
    doc.descendants((node, pos) => {
      if (node.type.name === 'code_block') {
        codeBlockPos = pos + 1
        return false
      }
      return true
    })

    const view = createMultiSegmentView(docJson, codeBlockPos)
    const target = resolveSessionUndoTarget(view, {
      isInlineAIControlsInteracting: () => false,
    })

    expect(target?.sessionId).toBe('session_a')
  })
})
