import { describe, expect, test } from 'bun:test'
import {
  findManuscriptMatchRanges,
  foldManuscriptText,
  matchManuscript,
  replaceManuscriptMatches,
} from './manuscript-edit-match.js'

describe('manuscript-edit-match', () => {
  test('unicode and whitespace matching contract', () => {
    const cases = [
      {
        name: 'curly quotes',
        manuscript: '“Hello,” she said—then paused.',
        needle: '"Hello," she said-then paused.',
        shouldMatch: true,
      },
      {
        name: 'NFD manuscript with NFC needle',
        manuscript: 'e\u0301clair',
        needle: 'éclair',
        shouldMatch: true,
      },
      {
        name: 'NBSP folded to space',
        manuscript: 'hello\u00a0world',
        needle: 'hello world',
        shouldMatch: true,
      },
      {
        name: 'CRLF folded to LF',
        manuscript: 'line one\r\nline two',
        needle: 'line one\nline two',
        shouldMatch: true,
      },
      {
        name: 'multiple spaces stay exact',
        manuscript: 'hello  world',
        needle: 'hello world',
        shouldMatch: false,
      },
      {
        name: 'tabs stay exact',
        manuscript: 'hello\tworld',
        needle: 'hello world',
        shouldMatch: false,
      },
    ] as const

    for (const entry of cases) {
      const ranges = findManuscriptMatchRanges(entry.manuscript, entry.needle)
      expect(ranges.length > 0).toBe(entry.shouldMatch)
      if (entry.shouldMatch) {
        expect(entry.manuscript.slice(ranges[0].start, ranges[0].end).length).toBeGreaterThan(0)
      }
    }

    expect(foldManuscriptText('“repeat”')).toBe(foldManuscriptText('"repeat"'))
  })

  test('diagnostics report manuscript line and offset', () => {
    const manuscript = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n')
    const targetLine = 25
    const lineText = `line ${targetLine}`
    const needle = `${lineText}ZZZZ`
    const result = matchManuscript(manuscript, needle)
    expect(result.ranges).toHaveLength(0)
    expect(result.diagnostic?.nearLine).toBe(targetLine)
    expect(result.diagnostic?.nearManuscriptOffset).toBeGreaterThan(0)
  })

  test('replace_all and single replacement behavior', () => {
    const manuscript = 'repeat repeat at the end.'
    const single = replaceManuscriptMatches(manuscript, 'repeat', 'echo', { replaceAll: false })
    expect(single.nextManuscript).toBe('echo repeat at the end.')

    const curly = '“repeat” and "repeat" again.'
    const all = replaceManuscriptMatches(curly, '"repeat"', 'echo', { replaceAll: true })
    expect(all.replacements).toBe(2)
    expect(all.nextManuscript).toBe('echo and echo again.')
  })
})
