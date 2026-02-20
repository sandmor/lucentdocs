import { describe, expect, test } from 'bun:test'
import { cleanText, createStreamCleaner } from './stream-cleaner.js'

describe('stream cleaner', () => {
  test('removes echoed prefix overlap at start', () => {
    const cleaned = cleanText('world and beyond', 'hello world ', null)
    expect(cleaned).toBe('and beyond')
  })

  test('removes trailing echoed suffix even after generated content', () => {
    const cleaned = cleanText('hello NEW TEXT and then bye', 'hello ', ' and then bye')
    expect(cleaned).toBe('NEW TEXT')
  })

  test('does not remove contextAfter when it appears in the middle', () => {
    const cleaned = cleanText('intro END middle tail', 'prefix ', ' tail')
    expect(cleaned).toBe('intro END middle')
  })

  test('keeps non-overlapping prefix content when overlap breaks', () => {
    const cleaned = cleanText('abcx', 'abcab', null)
    expect(cleaned).toBe('cx')
  })

  test('handles chunked streaming and trims end overlap across chunk boundaries', () => {
    const cleaner = createStreamCleaner('before ', ' after')

    const out = [
      cleaner.process('before N'),
      cleaner.process('EW TEX'),
      cleaner.process('T af'),
      cleaner.process('ter'),
      cleaner.flush(),
    ].join('')

    expect(out).toBe('NEW TEXT')
  })
})
