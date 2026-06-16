import { describe, expect, test } from 'bun:test'
import { schema } from './schema.js'

function findContentHole(spec: unknown): boolean {
  if (!Array.isArray(spec)) return false
  for (const item of spec) {
    if (item === 0) return true
    if (Array.isArray(item) && findContentHole(item)) return true
  }
  return false
}

describe('block id toDOM', () => {
  test.each(['paragraph', 'code_block'] as const)(
    '%s keeps ProseMirror content hole when id attrs are present',
    (type) => {
      const nodeType = schema.nodes[type]
      const node =
        type === 'code_block'
          ? nodeType.create({ id: 'test-block-id', language: 'js' })
          : nodeType.create({ id: 'test-block-id' })

      expect(findContentHole(nodeType.spec.toDOM!(node))).toBe(true)
    }
  )

  test('sets data-block-id only when block has an id', () => {
    const withId = schema.nodes.paragraph.spec.toDOM!(
      schema.nodes.paragraph.create({ id: 'test-block-id' })
    ) as unknown[]
    const withoutId = schema.nodes.paragraph.spec.toDOM!(
      schema.nodes.paragraph.create({ id: null })
    ) as unknown[]

    expect((withId[1] as Record<string, unknown>)['data-block-id']).toBe('test-block-id')
    expect(withoutId[1] === 0 || withoutId[1] === undefined).toBe(true)
  })
})
