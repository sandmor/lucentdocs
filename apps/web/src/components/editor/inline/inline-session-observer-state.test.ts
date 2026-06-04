import { describe, expect, test } from 'bun:test'
import {
  effectsFromInlineSnapshot,
  shouldStartChunkPumpForGeneration,
} from './inline-session-observer-state'
import { createEmptySession } from '../ai/writer/session-state'

describe('effectsFromInlineSnapshot', () => {
  test('keeps preview while generating', () => {
    const session = createEmptySession()
    expect(
      effectsFromInlineSnapshot({
        type: 'snapshot',
        sessionId: 's1',
        seq: 1,
        session,
        generating: true,
        generationId: 'g1',
      })
    ).toEqual({
      session,
      streamMeta: { generating: true, generationId: 'g1' },
      clearPreview: false,
    })
  })

  test('clears preview when generation ends', () => {
    const session = createEmptySession()
    expect(
      effectsFromInlineSnapshot({
        type: 'snapshot',
        sessionId: 's1',
        seq: 2,
        session,
        generating: false,
        generationId: null,
      }).clearPreview
    ).toBe(true)
  })

  test('settles the finished generation id when present', () => {
    const session = createEmptySession()
    expect(
      effectsFromInlineSnapshot({
        type: 'snapshot',
        sessionId: 's1',
        seq: 3,
        session,
        generating: false,
        generationId: 'g1',
        error: 'boom',
      }).settleGeneration
    ).toEqual({ generationId: 'g1', error: 'boom' })
  })
})

describe('shouldStartChunkPumpForGeneration', () => {
  test('starts when the active or pump generation id differs', () => {
    expect(shouldStartChunkPumpForGeneration(null, null, 'g1')).toBe(true)
    expect(shouldStartChunkPumpForGeneration('g1', null, 'g1')).toBe(true)
    expect(shouldStartChunkPumpForGeneration('g1', 'g1', 'g2')).toBe(true)
    expect(shouldStartChunkPumpForGeneration('g1', 'g1', 'g1')).toBe(false)
  })
})
