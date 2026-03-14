import { describe, expect, test } from 'bun:test'
import { planMarkdownImport } from './markdown-import.js'

describe('planMarkdownImport', () => {
  test('splits on headings at selected level', () => {
    const markdown = ['# One', 'a', '', '# Two', 'b', '', '# Three', 'c'].join('\n')
    const result = planMarkdownImport(markdown, {
      maxDocChars: 10_000,
      split: { type: 'heading', level: 1 },
    })

    expect(result.parts.map((p) => p.suggestedTitle)).toEqual(['One', 'Two', 'Three'])
    expect(result.parts).toHaveLength(3)
  })

  test('does not split inside fenced code blocks', () => {
    const markdown = ['# One', '```', '# Not a heading', '```', '', '# Two', 'b'].join('\n')

    const result = planMarkdownImport(markdown, {
      maxDocChars: 10_000,
      split: { type: 'heading', level: 1 },
    })

    expect(result.parts).toHaveLength(2)
    expect(result.parts[0]?.markdown).toContain('# Not a heading')
  })

  test('keeps YAML frontmatter in the first part', () => {
    const markdown = ['---', 'title: Hi', '---', '', '# One', 'a', '', '# Two', 'b'].join('\n')
    const result = planMarkdownImport(markdown, {
      maxDocChars: 10_000,
      split: { type: 'heading', level: 1 },
    })

    expect(result.parts[0]?.markdown.startsWith('---\n')).toBe(true)
    expect(result.parts[1]?.markdown.startsWith('---\n')).toBe(false)
  })

  test('enforces maxDocChars via size fallback', () => {
    const markdown = ['# One', 'a'.repeat(120), '', '# Two', 'b'.repeat(120)].join('\n')
    const result = planMarkdownImport(markdown, {
      maxDocChars: 80,
      targetDocChars: 60,
      split: { type: 'heading', level: 1 },
    })

    expect(result.parts.length).toBeGreaterThan(2)
    for (const part of result.parts) {
      expect(part.markdown.length).toBeLessThanOrEqual(80)
    }
  })

  test('converts <br> to markdown hardbreak outside code fences', () => {
    const markdown = ['Line<br>Two', '```', 'A<br>B', '```'].join('\n')
    const result = planMarkdownImport(markdown, {
      maxDocChars: 10_000,
      split: { type: 'none' },
      htmlMode: 'convert_basic',
    })

    expect(result.parts[0]?.markdown).toContain('Line\\\nTwo')
    expect(result.parts[0]?.markdown).toContain('A<br>B')
  })

  test('convert_basic preserves links and images from HTML blocks', () => {
    const markdown = [
      '<p>See <a href=\"https://example.com\">Example</a></p>',
      '<img src=\"image.png\" alt=\"Alt text\" />',
    ].join('\n')

    const result = planMarkdownImport(markdown, {
      maxDocChars: 10_000,
      split: { type: 'none' },
      htmlMode: 'convert_basic',
    })

    const out = result.parts[0]?.markdown ?? ''
    expect(out).toContain('[Example](https://example.com)')
    expect(out).toContain('![Alt text](image.png)')
  })

  test('convert_basic strips inline span anchors', () => {
    const markdown = 'Start <span id="chapter_1.xhtml"></span> End'
    const result = planMarkdownImport(markdown, {
      maxDocChars: 10_000,
      split: { type: 'none' },
      htmlMode: 'convert_basic',
    })

    const out = result.parts[0]?.markdown ?? ''
    expect(out).not.toContain('<span')
    expect(out).toContain('Start')
    expect(out).toContain('End')
  })

  test('convert_basic does not touch span-like text inside inline code spans', () => {
    const markdown = 'Literal `<span id="x"></span>` stays'
    const result = planMarkdownImport(markdown, {
      maxDocChars: 10_000,
      split: { type: 'none' },
      htmlMode: 'convert_basic',
    })

    expect(result.parts[0]?.markdown).toContain('`<span id="x"></span>`')
  })

  test('convert_basic preserves CommonMark autolinks while converting other inline HTML', () => {
    const markdown = 'Link: <https://example.com> <span id="x"></span>'
    const result = planMarkdownImport(markdown, {
      maxDocChars: 10_000,
      split: { type: 'none' },
      htmlMode: 'convert_basic',
    })

    const out = result.parts[0]?.markdown ?? ''
    expect(out).toContain('<https://example.com>')
    expect(out).not.toContain('<span')
  })
})
