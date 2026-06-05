import { describe, expect, test } from 'bun:test'
import { ensureLanguageLoaded } from '@/lib/refractor-languages'
import { getHighlightedHTML, getHighlightedHTMLAsync } from './syntax-highlighter'

describe('getHighlightedHTML', () => {
  test('returns escaped plain text for empty language', () => {
    expect(getHighlightedHTML('a < b', '')).toBe('a &lt; b')
    expect(getHighlightedHTML('a < b', 'plain')).toBe('a &lt; b')
  })

  test('falls back to escaped text before grammar is loaded', () => {
    expect(getHighlightedHTML('const x = 1', 'javascript')).toBe('const x = 1')
  })

  test('falls back to escaped text for unknown languages', () => {
    expect(getHighlightedHTML('fn main() {}', 'not-a-real-language')).toBe('fn main() {}')
  })

  test('escapes HTML in plain fallback', () => {
    expect(getHighlightedHTML('<script>', 'unknown-lang')).toBe('&lt;script&gt;')
  })
})

describe('getHighlightedHTMLAsync', () => {
  test('highlights known languages with token classes', async () => {
    await ensureLanguageLoaded('javascript')
    const html = await getHighlightedHTMLAsync('const x = 1', 'javascript')
    expect(html).toContain('class="token keyword"')
    expect(html).toContain('const')
  })

  test('resolves aliases before highlighting', async () => {
    await ensureLanguageLoaded('js')
    const html = await getHighlightedHTMLAsync('const x = 1', 'js')
    expect(html).toContain('class="token keyword"')
  })

  test('loads rarely used grammars on demand', async () => {
    await ensureLanguageLoaded('zig')
    const html = await getHighlightedHTMLAsync('const std = @import("std");', 'zig')
    expect(html).toContain('token')
  })

  test('falls back to escaped text for unknown languages', async () => {
    expect(await getHighlightedHTMLAsync('fn main() {}', 'not-a-real-language')).toBe('fn main() {}')
  })

  test('dedupes concurrent grammar loads', async () => {
    const [first, second] = await Promise.all([
      ensureLanguageLoaded('haskell'),
      ensureLanguageLoaded('haskell'),
    ])
    expect(first).toBe(true)
    expect(second).toBe(true)
  })
})
