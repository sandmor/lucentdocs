import { describe, expect, test } from 'bun:test'
import { getLocalPresenceUser, normalizePresenceUser, samePresenceRects } from './presence.js'

describe('getLocalPresenceUser', () => {
  test('returns a stable name and a supported hex color', () => {
    const first = getLocalPresenceUser(42)
    const second = getLocalPresenceUser(42)

    expect(first).toEqual(second)
    expect(first.name).toBe('User 42')
    expect(first.color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  test('distributes different client ids across the palette', () => {
    const first = getLocalPresenceUser(1)
    const second = getLocalPresenceUser(2)

    expect(first.color).not.toBe(second.color)
  })

  test('normalizes missing presence user payloads', () => {
    expect(normalizePresenceUser(null, 7)).toEqual(getLocalPresenceUser(7))
  })

  test('falls back when presence user color is invalid', () => {
    expect(normalizePresenceUser({ name: 'Ada', color: 'red' }, 5)).toEqual({
      name: 'Ada',
      color: getLocalPresenceUser(5).color,
    })
  })

  test('compares presence rect arrays structurally', () => {
    expect(
      samePresenceRects(
        [{ left: 1, top: 2, width: 3, height: 4 }],
        [{ left: 1, top: 2, width: 3, height: 4 }]
      )
    ).toBe(true)
    expect(
      samePresenceRects(
        [{ left: 1, top: 2, width: 3, height: 4 }],
        [{ left: 1, top: 2, width: 5, height: 4 }]
      )
    ).toBe(false)
  })
})
