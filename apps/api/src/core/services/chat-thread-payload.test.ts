import { describe, expect, test } from 'bun:test'
import {
  createEmptyChatThreadPayload,
  isChatThreadPayload,
  parseThreadPayload,
  serializeThreadPayload,
  ChatThreadPayloadError,
} from './chat-thread-payload.js'

describe('chat-thread-payload', () => {
  test('round-trips v2 envelope with settings', () => {
    const payload = createEmptyChatThreadPayload()
    payload.settings.editingEnabled = true
    payload.rootChildIds = ['user-1']
    payload.selectedRootChildId = 'user-1'
    payload.nodes['user-1'] = {
      id: 'user-1',
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
      parentId: null,
      childIds: [],
      selectedChildId: null,
    }

    const parsed = parseThreadPayload(serializeThreadPayload(payload))
    expect(parsed).toEqual(payload)
  })

  test('rejects legacy v1 and plain-array payloads', () => {
    expect(() => parseThreadPayload('[]')).toThrow(ChatThreadPayloadError)
    expect(() =>
      parseThreadPayload('{"v":1,"settings":{"editingEnabled":false},"messages":[]}')
    ).toThrow(ChatThreadPayloadError)
  })

  test('rejects malformed envelopes', () => {
    expect(() => parseThreadPayload('{"v":2,"settings":{},"nodes":{}}')).toThrow(
      ChatThreadPayloadError
    )
    expect(isChatThreadPayload(createEmptyChatThreadPayload())).toBe(true)
  })
})
