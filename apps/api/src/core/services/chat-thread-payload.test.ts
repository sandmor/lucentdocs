import { describe, expect, test } from 'bun:test'
import {
  createEmptyChatThreadPayload,
  isChatThreadPayloadV1,
  parseThreadPayload,
  serializeThreadPayload,
  ChatThreadPayloadError,
} from './chat-thread-payload.js'

describe('chat-thread-payload', () => {
  test('round-trips v1 envelope with settings', () => {
    const payload = createEmptyChatThreadPayload()
    payload.settings.editingEnabled = true
    payload.messages = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }]

    const parsed = parseThreadPayload(serializeThreadPayload(payload))
    expect(parsed).toEqual(payload)
  })

  test('rejects legacy plain-array payloads', () => {
    expect(() => parseThreadPayload('[]')).toThrow(ChatThreadPayloadError)
    expect(() => parseThreadPayload('[{"role":"user"}]')).toThrow(ChatThreadPayloadError)
  })

  test('rejects malformed envelopes', () => {
    expect(() => parseThreadPayload('{"v":2,"settings":{},"messages":[]}')).toThrow(
      ChatThreadPayloadError
    )
    expect(() => parseThreadPayload('{"v":1,"messages":[]}')).toThrow(ChatThreadPayloadError)
    expect(isChatThreadPayloadV1({ v: 1, settings: { editingEnabled: false }, messages: [] })).toBe(
      true
    )
  })
})
