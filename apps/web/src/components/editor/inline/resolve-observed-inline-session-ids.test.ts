import { describe, expect, test } from 'bun:test'
import type { AIWriterState } from '../ai/writer-plugin'
import {
  resolveHydratedInlineSessionIds,
  resolveObservedInlineSessionIds,
} from './resolve-observed-inline-session-ids'

function aiState(overrides: Partial<AIWriterState> = {}): AIWriterState {
  return {
    active: false,
    from: null,
    to: null,
    zoneId: null,
    sessionId: null,
    streaming: false,
    stuck: false,
    originalSlice: null,
    originalFrom: null,
    originalSelectionFrom: null,
    originalSelectionTo: null,
    preGenerationAnchor: null,
    userPlacedCaretInZone: false,
    zones: [],
    ...overrides,
  }
}

describe('resolveObservedInlineSessionIds', () => {
  test('includes only streaming zones', () => {
    const ids = resolveObservedInlineSessionIds(
      aiState({
        zones: [
          {
            id: 'z1',
            sessionId: 's-streaming',
            streaming: true,
            nodeFrom: 0,
            nodeTo: 1,
            segments: [{ nodeFrom: 0, nodeTo: 1 }],
            originalSlice: null,
          },
          {
            id: 'z2',
            sessionId: 's-idle',
            streaming: false,
            nodeFrom: 2,
            nodeTo: 3,
            segments: [{ nodeFrom: 2, nodeTo: 3 }],
            originalSlice: null,
          },
        ],
      }),
      {}
    )

    expect(ids).toEqual(['s-streaming'])
  })

  test('keeps subscription while server stream meta reports generating', () => {
    const ids = resolveObservedInlineSessionIds(
      aiState({
        zones: [
          {
            id: 'z1',
            sessionId: 's1',
            streaming: false,
            nodeFrom: 0,
            nodeTo: 1,
            segments: [{ nodeFrom: 0, nodeTo: 1 }],
            originalSlice: null,
          },
        ],
      }),
      { s1: { generating: true, generationId: 'g1' } }
    )

    expect(ids).toEqual(['s1'])
  })

  test('includes active compose session while streaming', () => {
    const ids = resolveObservedInlineSessionIds(
      aiState({
        active: true,
        streaming: true,
        sessionId: 'compose-s',
        zoneId: 'z-compose',
      }),
      {}
    )

    expect(ids).toEqual(['compose-s'])
  })
})

describe('resolveHydratedInlineSessionIds', () => {
  test('includes all zone sessions and active compose session', () => {
    const ids = resolveHydratedInlineSessionIds(
      aiState({
        sessionId: 'compose-s',
        zones: [
          {
            id: 'z1',
            sessionId: 's1',
            streaming: false,
            nodeFrom: 0,
            nodeTo: 1,
            segments: [{ nodeFrom: 0, nodeTo: 1 }],
            originalSlice: null,
          },
        ],
      })
    )

    expect(ids).toEqual(['compose-s', 's1'])
  })
})
