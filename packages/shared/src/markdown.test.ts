import { describe, expect, test } from 'bun:test'
import { proseMirrorDocToMarkdown } from './markdown.js'

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
