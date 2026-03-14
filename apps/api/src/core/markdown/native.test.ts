import { describe, expect, test } from 'bun:test'
import { planMarkdownImport } from './native.js'

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw result.error
  return result.value
}

describe('planMarkdownImport', () => {
  test('splits on headings at selected level', () => {
    const markdown = ['# One', 'a', '', '# Two', 'b', '', '# Three', 'c'].join('\n')
    const result = unwrap(
      planMarkdownImport(markdown, {
        maxDocChars: 10_000,
        split: { type: 'heading', level: 1 },
      })
    )

    expect(result.parts.map((p) => p.suggestedTitle)).toEqual(['One', 'Two', 'Three'])
    expect(result.parts).toHaveLength(3)
  })

  test('splits on setext headings at selected level', () => {
    const markdown = ['One', '---', 'a', '', 'Two', '---', 'b', '', 'Three', '---', 'c'].join('\n')
    const result = unwrap(
      planMarkdownImport(markdown, {
        maxDocChars: 10_000,
        split: { type: 'heading', level: 2 },
      })
    )

    expect(result.parts.map((p) => p.suggestedTitle)).toEqual(['One', 'Two', 'Three'])
    expect(result.parts).toHaveLength(3)
  })

  test('does not split inside fenced code blocks', () => {
    const markdown = ['# One', '```', '# Not a heading', '```', '', '# Two', 'b'].join('\n')

    const result = unwrap(
      planMarkdownImport(markdown, {
        maxDocChars: 10_000,
        split: { type: 'heading', level: 1 },
      })
    )

    expect(result.parts).toHaveLength(2)
  })

  test('converts inline HTML elements like br', () => {
    const markdown = ['Line<br>Two', '', 'A<br>B'].join('\n')
    const result = unwrap(
      planMarkdownImport(markdown, {
        maxDocChars: 10_000,
        split: { type: 'none' },
      })
    )

    expect(result.parts[0]?.markdown).toContain('Line\\\nTwo')
    expect(result.parts[0]?.markdown).toContain('A\\\nB')
  })

  test('preserves links and images from HTML blocks', () => {
    const markdown = [
      '<p>See <a href="https://example.com">Example</a></p>',
      '<img src="image.png" alt="Alt text" />',
    ].join('\n')

    const result = unwrap(
      planMarkdownImport(markdown, {
        maxDocChars: 10_000,
        split: { type: 'none' },
      })
    )

    const out = result.parts[0]?.markdown ?? ''
    expect(out).toContain('[Example](https://example.com)')
    expect(out).toContain('![Alt text](image.png)')
  })

  test('strips inline span anchors', () => {
    const markdown = 'Start <span id="chapter_1.xhtml"></span> End'
    const result = unwrap(
      planMarkdownImport(markdown, {
        maxDocChars: 10_000,
        split: { type: 'none' },
      })
    )

    const out = result.parts[0]?.markdown ?? ''
    expect(out).toContain('Start')
    expect(out).toContain('End')
  })

  test('does not touch span-like text inside inline code spans', () => {
    const markdown = 'Literal `<span id="x"></span>` stays'
    const result = unwrap(
      planMarkdownImport(markdown, {
        maxDocChars: 10_000,
        split: { type: 'none' },
      })
    )

    expect(result.parts[0]?.markdown).toContain('`<span id="x"></span>`')
  })

  test('preserves CommonMark autolinks while converting other inline HTML', () => {
    const markdown = 'Link: <https://example.com> <span id="x"></span>'
    const result = unwrap(
      planMarkdownImport(markdown, {
        maxDocChars: 10_000,
        split: { type: 'none' },
      })
    )

    const out = result.parts[0]?.markdown ?? ''
    expect(out).toContain('<https://example.com>')
    expect(out).not.toContain('<span')
  })

  test('strips unsupported HTML blocks when rawHtmlMode is drop', () => {
    const markdown = ['Before', '', '<table><tr><td>Cell</td></tr></table>', '', 'After'].join('\n')
    const result = unwrap(
      planMarkdownImport(markdown, {
        maxDocChars: 10_000,
        split: { type: 'none' },
        rawHtmlMode: 'drop',
      })
    )

    const out = result.parts[0]?.markdown ?? ''
    expect(out).toContain('Before')
    expect(out).toContain('After')
    expect(out).not.toContain('<table')
    expect(out).not.toContain('```html')
  })
})
