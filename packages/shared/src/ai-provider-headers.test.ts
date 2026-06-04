import { describe, expect, test } from 'bun:test'
import {
  fingerprintCustomHeaders,
  mergeProviderRequestHeaders,
  normalizeCustomHeaders,
} from './ai-provider-headers.js'

describe('normalizeCustomHeaders', () => {
  test('returns empty object for nullish input', () => {
    expect(normalizeCustomHeaders(undefined)).toEqual({})
    expect(normalizeCustomHeaders(null)).toEqual({})
    expect(normalizeCustomHeaders('')).toEqual({})
  })

  test('parses JSON strings and trims keys/values', () => {
    expect(normalizeCustomHeaders('{" X-Custom ": " value "} ')).toEqual({
      'X-Custom': 'value',
    })
  })

  test('rejects invalid header names and duplicate keys', () => {
    expect(() => normalizeCustomHeaders({ 'bad name': 'value' })).toThrow(
      'Invalid custom header name'
    )
    expect(() => normalizeCustomHeaders({ 'X-One': '1', ' X-One ': '2' })).toThrow('Duplicate')
  })

  test('enforces entry limits', () => {
    const headers = Object.fromEntries(
      Array.from({ length: 21 }, (_, index) => [`X-Header-${index}`, 'value'])
    )
    expect(() => normalizeCustomHeaders(headers)).toThrow('cannot exceed 20 entries')
  })
})

describe('mergeProviderRequestHeaders', () => {
  test('lets built-in headers win on conflict', () => {
    expect(
      mergeProviderRequestHeaders(
        {
          accept: 'application/json',
          authorization: 'Bearer default',
        },
        {
          authorization: 'Bearer custom',
          'X-Custom': 'gateway',
        }
      )
    ).toEqual({
      authorization: 'Bearer default',
      'X-Custom': 'gateway',
      accept: 'application/json',
    })
  })
})

describe('fingerprintCustomHeaders', () => {
  test('returns stable sorted fingerprint', () => {
    expect(
      fingerprintCustomHeaders({
        'X-B': '2',
        'X-A': '1',
      })
    ).toBe('X-A=1&X-B=2')
    expect(fingerprintCustomHeaders({})).toBe('none')
  })
})
