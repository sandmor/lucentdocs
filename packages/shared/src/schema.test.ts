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
    ) as unknown as unknown[]
    const withoutId = schema.nodes.paragraph.spec.toDOM!(
      schema.nodes.paragraph.create({ id: null })
    ) as unknown as unknown[]

    expect((withId[1] as Record<string, unknown>)['data-block-id']).toBe('test-block-id')
    expect(withoutId[1] === 0 || withoutId[1] === undefined).toBe(true)
  })

  test('renders task-item content inside a dedicated wrapper', () => {
    const spec = schema.nodes.list_item.spec.toDOM!(
      schema.nodes.list_item.create(
        { checked: false },
        schema.nodes.paragraph.create(null, schema.text('Plan release'))
      )
    ) as unknown as unknown[]

    expect(spec[0]).toBe('li')
    expect((spec[2] as unknown[])[0]).toBe('input')
    expect((spec[3] as unknown[])[0]).toBe('div')
    expect(findContentHole(spec[3])).toBe(true)
  })
})

describe('math schema nodes', () => {
  test('exposes canonical source as leaf text', () => {
    expect(schema.nodes.math_inline.create({ latex: 'x^2' }).textContent).toBe('$x^2$')
    expect(schema.nodes.math_block.create({ latex: 'x=y' }).textContent).toBe('$$\nx=y\n$$')
  })
})
