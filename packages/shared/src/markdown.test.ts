import { describe, expect, test } from 'bun:test'
import { proseMirrorDocToMarkdown } from './markdown.js'
import { hasRecognizedMarkdownSyntax, parseMarkdownishToFragment, parseMarkdownishToSlice } from './markdownish.js'

describe('list Markdown serialization', () => {
  test('serializes nested checklists as GFM tasks', () => {
    const result = proseMirrorDocToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'bullet_list',
          attrs: { kind: 'task' },
          content: [
            {
              type: 'list_item',
              attrs: { checked: true },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Shipped' }] },
                {
                  type: 'bullet_list',
                  attrs: { kind: 'task' },
                  content: [
                    {
                      type: 'list_item',
                      attrs: { checked: false },
                      content: [
                        { type: 'paragraph', content: [{ type: 'text', text: 'Document it' }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })

    expect(result).toEqual({ ok: true, value: '- [x] Shipped\n\n  - [ ] Document it' })
  })
})

describe('math Markdown serialization and parsing', () => {
  test('round trips canonical inline and display math', () => {
    const result = proseMirrorDocToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Area ' },
            { type: 'math_inline', attrs: { latex: 'r^2' } },
          ],
        },
        { type: 'math_block', attrs: { latex: '\\int_0^1 x\\,dx' } },
      ],
    })

    expect(result).toEqual({ ok: true, value: 'Area $r^2$\n\n$$\n\\int_0^1 x\\,dx\n$$' })

    const parsed = parseMarkdownishToFragment(result.ok ? result.value : '')
    expect(parsed.firstChild?.child(1).type.name).toBe('math_inline')
    expect(parsed.lastChild?.type.name).toBe('math_block')
    expect(parsed.lastChild?.attrs.latex).toBe('\\int_0^1 x\\,dx')
  })

  test('keeps unmatched and escaped dollar text literal', () => {
    const parsed = parseMarkdownishToFragment('Cost \\$5 and $ unfinished')
    expect(parsed.firstChild?.textContent).toBe('Cost $5 and $ unfinished')
  })

  test('detects pasteable math syntax and keeps note math inline-only', () => {
    expect(hasRecognizedMarkdownSyntax('Area $r^2$')).toBe(true)
    expect(hasRecognizedMarkdownSyntax('just plain prose')).toBe(false)

    const noteInline = parseMarkdownishToSlice('Area $r^2$', { target: 'note' })
    expect(noteInline.content.firstChild?.child(1).type.name).toBe('math_inline')

    const noteDisplay = parseMarkdownishToSlice('$$\nr^2\n$$', { target: 'note' })
    expect(noteDisplay.content.firstChild?.textContent).toContain('$$')
  })
})
