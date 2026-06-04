import { describe, expect, test } from 'bun:test'
import { getHighlightedHTML } from './syntax-highlighter'

describe('getHighlightedHTML', () => {
  test('returns escaped plain text for empty language', () => {
    expect(getHighlightedHTML('a < b', '')).toBe('a &lt; b')
    expect(getHighlightedHTML('a < b', 'plain')).toBe('a &lt; b')
  })

  test('highlights known languages with token classes', () => {
    const html = getHighlightedHTML('const x = 1', 'javascript')
    expect(html).toContain('class="token keyword"')
    expect(html).toContain('const')
  })

  test('resolves aliases before highlighting', () => {
    const html = getHighlightedHTML('const x = 1', 'js')
    expect(html).toContain('class="token keyword"')
  })

  test('falls back to escaped text for unknown languages', () => {
    expect(getHighlightedHTML('fn main() {}', 'not-a-real-language')).toBe('fn main() {}')
  })

  test('escapes HTML in plain fallback', () => {
    expect(getHighlightedHTML('<script>', 'unknown-lang')).toBe('&lt;script&gt;')
  })
})
