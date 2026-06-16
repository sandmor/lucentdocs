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
})
