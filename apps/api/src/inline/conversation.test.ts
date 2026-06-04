import { describe, expect, test } from 'bun:test'
import type { InlineZoneSession } from '@lucentdocs/shared'
import { serializeInlineConversation, sessionAfterInterruptedGeneration } from './conversation.js'

function createSession(messages: InlineZoneSession['messages']): InlineZoneSession {
  return {
    messages,
    choices: [],
    contextBefore: null,
    contextAfter: null,
    contextTruncated: false,
  }
}

describe('serializeInlineConversation', () => {
  test('includes tool-only assistant turns', () => {
    const session = createSession([
      { id: 'u1', role: 'user', text: 'Rewrite this', tools: [] },
      {
        id: 'a1',
        role: 'assistant',
        text: '',
        tools: [{ toolName: 'write_zone', state: 'complete' }],
      },
    ])

    expect(serializeInlineConversation(session)).toBe(
      'User: Rewrite this\nAssistant: [used tools: write_zone]'
    )
  })

  test('excludes trailing user when excludeTrailingUser is set', () => {
    const session = createSession([
      { id: 'u1', role: 'user', text: 'First ask', tools: [] },
      { id: 'a1', role: 'assistant', text: 'Done.', tools: [] },
      { id: 'u2', role: 'user', text: 'Follow up', tools: [] },
    ])

    expect(serializeInlineConversation(session, { excludeTrailingUser: true })).toBe(
      'User: First ask\nAssistant: Done.'
    )
  })

  test('keeps only the recent tail of conversation lines', () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({
      id: `u${index}`,
      role: 'user' as const,
      text: `message ${index}`,
      tools: [],
    }))
    const session = createSession(messages)
    const lines = serializeInlineConversation(session).split('\n')

    expect(lines).toHaveLength(24)
    expect(lines[0]).toBe('User: message 6')
    expect(lines[23]).toBe('User: message 29')
  })
})

describe('sessionAfterInterruptedGeneration', () => {
  test('removes assistant output from the interrupted run but keeps new user turns', () => {
    const baseline = createSession([
      { id: 'u1', role: 'user', text: 'First', tools: [] },
      { id: 'a1', role: 'assistant', text: 'Answer', tools: [] },
    ])
    const generation = createSession([
      { id: 'u1', role: 'user', text: 'First', tools: [] },
      { id: 'a1', role: 'assistant', text: 'Answer', tools: [] },
      { id: 'u2', role: 'user', text: 'Follow up', tools: [] },
      { id: 'a2', role: 'assistant', text: 'Partial…', tools: [] },
    ])

    expect(sessionAfterInterruptedGeneration(generation, baseline).messages).toEqual([
      { id: 'u1', role: 'user', text: 'First', tools: [] },
      { id: 'a1', role: 'assistant', text: 'Answer', tools: [] },
      { id: 'u2', role: 'user', text: 'Follow up', tools: [] },
    ])
  })
})
