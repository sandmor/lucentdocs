import { describe, expect, test } from 'bun:test'
import { canUndoSessionTurn, type InlineZoneSession } from './inline-ai-session.js'

function createSession(turnCheckpointCount: number): InlineZoneSession {
  const turnCheckpoints = Array.from({ length: turnCheckpointCount }, (_, index) => ({
    assistantMessageId: `msg_${index}`,
    zoneTextBefore: 'before',
    zoneTextAfter: 'after',
    assistantMessage: {
      id: `msg_${index}`,
      role: 'assistant' as const,
      text: 'AI text',
      tools: [],
    },
  }))

  return {
    messages: [],
    choices: [],
    contextBefore: null,
    contextAfter: null,
    contextTruncated: false,
    ...(turnCheckpointCount > 0 ? { turnCheckpoints } : {}),
  }
}

describe('canUndoSessionTurn', () => {
  test('returns false for null or undefined session', () => {
    expect(canUndoSessionTurn(null)).toBe(false)
    expect(canUndoSessionTurn(undefined)).toBe(false)
  })

  test('returns false when there are no turn checkpoints', () => {
    expect(canUndoSessionTurn(createSession(0))).toBe(false)
  })

  test('returns false for a single turn checkpoint', () => {
    expect(canUndoSessionTurn(createSession(1))).toBe(false)
  })

  test('returns true when there are multiple turn checkpoints', () => {
    expect(canUndoSessionTurn(createSession(2))).toBe(true)
    expect(canUndoSessionTurn(createSession(3))).toBe(true)
  })
})
