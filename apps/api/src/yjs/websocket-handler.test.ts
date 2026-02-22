import { describe, expect, test } from 'bun:test'
import { nanoid } from 'nanoid'
import { extractDocumentIdFromYjsUrl } from './websocket-handler.js'

describe('extractDocumentIdFromYjsUrl', () => {
  test('extracts valid document id from y-websocket URL', () => {
    const id = nanoid()
    const result = extractDocumentIdFromYjsUrl(`/api/yjs/${id}?foo=bar`, 'localhost:5678')
    expect(result).toBe(id)
  })

  test('returns null when URL path is not a valid yjs document route', () => {
    const result = extractDocumentIdFromYjsUrl('/api/yjs-extra/not-an-id', 'localhost:5678')
    expect(result).toBeNull()
  })

  test('returns null when URL cannot be parsed', () => {
    const result = extractDocumentIdFromYjsUrl('http://[::1', 'localhost:5678')
    expect(result).toBeNull()
  })
})
