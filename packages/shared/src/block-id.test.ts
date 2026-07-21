import { describe, expect, test } from 'bun:test'
import { ensureBlockIds, collectTopLevelBlockIds } from './block-id.js'

describe('ensureBlockIds', () => {
  test('assigns unique ids to top-level blocks', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [] },
        { type: 'paragraph', content: [] },
      ],
    }

    const ids = collectTopLevelBlockIds(ensureBlockIds(doc))
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every((id) => /^[a-f0-9-]{36}$|^blk_/.test(id))).toBe(true)
  })

  test('assigns identity to a list as one block, not to its items', () => {
    const result = ensureBlockIds({
      type: 'doc',
      content: [
        {
          type: 'bullet_list',
          content: [
            {
              type: 'list_item',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }],
            },
          ],
        },
      ],
    })

    const list = (result.content as Array<Record<string, unknown>>)[0]!
    const item = (list.content as Array<Record<string, unknown>>)[0]!
    expect((list.attrs as Record<string, unknown>).id).toBeTruthy()
    expect(item.attrs).toBeUndefined()
  })
})
