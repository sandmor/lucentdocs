import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_PROMPT_EXCERPT_CHARS,
  MIN_PROMPT_EXCERPT_CHARS,
  buildBoundedExcerpt,
  buildPromptContextExcerpt,
  renderContextParts,
  takeTailExcerpt,
  takeHeadExcerpt,
  clipMiddleExcerpt,
} from './prompt-excerpt.js'

describe('takeTailExcerpt', () => {
  test('returns full text when within limit', () => {
    const result = takeTailExcerpt('short text', 100)
    expect(result.text).toBe('short text')
    expect(result.truncated).toBe(false)
  })

  test('returns trailing excerpt with omission marker when over limit', () => {
    const result = takeTailExcerpt('start middle end', 5)
    expect(result.text.length).toBeLessThanOrEqual(5)
    expect(result.truncated).toBe(true)
  })
})

describe('takeHeadExcerpt', () => {
  test('returns full text when within limit', () => {
    const result = takeHeadExcerpt('short text', 100)
    expect(result.text).toBe('short text')
    expect(result.truncated).toBe(false)
  })

  test('returns leading excerpt with omission marker when over limit', () => {
    const result = takeHeadExcerpt('start middle end', 5)
    expect(result.text.length).toBeLessThanOrEqual(5)
    expect(result.truncated).toBe(true)
  })
})

describe('clipMiddleExcerpt', () => {
  test('returns full text when within limit', () => {
    const result = clipMiddleExcerpt('short text', 100)
    expect(result.text).toBe('short text')
    expect(result.truncated).toBe(false)
  })

  test('returns clipped excerpt with middle omission marker', () => {
    const result = clipMiddleExcerpt('start middle end', 6)
    expect(result.text.length).toBeLessThanOrEqual(6)
    expect(result.truncated).toBe(true)
  })
})

describe('prompt excerpt constants', () => {
  test('exposes shared defaults for prompt excerpt budgets', () => {
    expect(DEFAULT_PROMPT_EXCERPT_CHARS).toBe(12_000)
    expect(MIN_PROMPT_EXCERPT_CHARS).toBeGreaterThan(0)
  })
})

describe('buildBoundedExcerpt', () => {
  test('returns full content when everything fits', () => {
    const result = buildBoundedExcerpt('before', 'caret', '', 'after', 100)
    expect(renderContextParts(result)).toBe('before<caret />after')
    expect(result.truncated).toBe(false)
    expect(result.truncatedBefore).toBe(false)
    expect(result.truncatedAfter).toBe(false)
    expect(result.truncatedMarker).toBe(false)
    expect(result.before).toBe('before')
    expect(result.markerKind).toBe('caret')
    expect(result.markerContent).toBe('')
    expect(result.after).toBe('after')
  })

  test('does not include truncation notice when not truncated', () => {
    const result = buildBoundedExcerpt('small', 'caret', '', 'text', 100)
    expect(renderContextParts(result)).not.toContain('<truncation_notice')
  })

  test('includes truncation notice when truncated', () => {
    const before = 'a'.repeat(6000)
    const after = 'b'.repeat(6000)
    const result = buildBoundedExcerpt(before, 'caret', '', after, 5000)
    expect(renderContextParts(result)).toContain('<truncation_notice')
    expect(result.truncated).toBe(true)
    expect(result.before).toContain('<truncation_notice')
    expect(result.after).toContain('b')
    expect(renderContextParts(result).length).toBeLessThanOrEqual(5000)
  })

  test('uses dynamic budget allocation when one side fits', () => {
    const before = 'short'
    const after = 'b'.repeat(10000)
    const result = buildBoundedExcerpt(before, 'caret', '', after, 5000)
    expect(renderContextParts(result)).toContain('short')
    expect(renderContextParts(result)).toContain('<caret />')
    expect(result.truncated).toBe(true)
    expect(result.truncatedAfter).toBe(true)
    expect(result.truncatedBefore).toBe(false)
  })

  test('preserves selection wrapper tags when content is clipped', () => {
    const before = 'a'.repeat(6000)
    const after = 'b'.repeat(6000)
    const result = buildBoundedExcerpt(before, 'selection', 'selected text', after, 5000)
    expect(renderContextParts(result)).toContain('<selection>')
    expect(result.truncated).toBe(true)
  })

  test('renders selection with full content when everything fits', () => {
    const result = buildBoundedExcerpt('short', 'selection', 'selected text', 'text', 5000)
    expect(renderContextParts(result)).toBe('short<selection>selected text</selection>text')
    expect(result.truncated).toBe(false)
  })

  test('splits budget evenly when both sides need truncation', () => {
    const before = 'a'.repeat(10000)
    const after = 'b'.repeat(10000)
    const result = buildBoundedExcerpt(before, 'caret', '', after, 5000)
    expect(renderContextParts(result)).toContain('<omitted content="earlier"/>')
    expect(renderContextParts(result)).toContain('<omitted content="later"/>')
    expect(result.truncated).toBe(true)
    expect(result.truncatedBefore).toBe(true)
    expect(result.truncatedAfter).toBe(true)
    expect(renderContextParts(result).length).toBeLessThanOrEqual(5000)
  })

  test('marks marker-only clipping as truncated', () => {
    const result = buildBoundedExcerpt('before', 'selection', 'x'.repeat(2000), 'after', 500)

    expect(result.truncated).toBe(true)
    expect(result.truncatedMarker).toBe(true)
    expect(renderContextParts(result)).toContain('<truncation_notice')
    expect(renderContextParts(result).length).toBeLessThanOrEqual(500)
  })

  test('keeps selection content clipped with middle omission when over budget', () => {
    const result = buildBoundedExcerpt('before', 'selection', 'x'.repeat(10_000), 'after', 600)

    expect(result.truncatedMarker).toBe(true)
    expect(result.markerContent).toContain('<omitted content="middle"/>')
    const rendered = renderContextParts(result)
    expect(rendered.startsWith(rendered.slice(0, rendered.indexOf('<selection>') + 1))).toBe(true)
    expect(rendered).toContain('<selection>')
    expect(rendered).toContain('</selection>')
    expect(rendered.length).toBeLessThanOrEqual(600)
  })

  test('clips selection marker content while preserving wrapper tags', () => {
    const result = buildBoundedExcerpt(
      '',
      'selection',
      'abcdefghijklmnopqrstuvwxyz'.repeat(250),
      '',
      400
    )
    const rendered = renderContextParts(result)

    expect(rendered).toContain('</selection>')
    expect(rendered).toContain('<selection>')
    expect(rendered).toContain('<selection>abc')
  })

  test('normalizes very small budgets to a safe minimum', () => {
    const result = buildBoundedExcerpt('a'.repeat(1000), 'caret', '', 'b'.repeat(1000), 5)

    expect(result.truncated).toBe(true)
    expect(renderContextParts(result).length).toBeLessThanOrEqual(MIN_PROMPT_EXCERPT_CHARS)
  })
})

describe('buildPromptContextExcerpt', () => {
  test('returns context parts from the bounded excerpt', () => {
    const result = buildPromptContextExcerpt('before', 'caret', '', 'after', 500)

    expect(result.before).toBe('before')
    expect(result.after).toBe('after')
    expect(result.markerKind).toBe('caret')
    expect(result.markerContent).toBe('')
    expect(renderContextParts(result)).toBe('before<caret />after')
  })
})
