import { describe, expect, test } from 'bun:test'
import { schema } from './schema.js'
import { proseMirrorDocToMarkdown } from './markdown.js'

describe('proseMirrorDocToMarkdown', () => {
  test('includes code block language in fenced output', () => {
    const doc = schema.node('doc', null, [
      schema.node('code_block', { language: 'typescript' }, [schema.text('const x = 1')]),
    ])

    const result = proseMirrorDocToMarkdown(doc.toJSON())

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value).toBe('```typescript\nconst x = 1\n```')
  })

  test('omits fence info when code block language is empty', () => {
    const doc = schema.node('doc', null, [
      schema.node('code_block', { language: '' }, [schema.text('plain')]),
    ])

    const result = proseMirrorDocToMarkdown(doc.toJSON())

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value).toBe('```\nplain\n```')
  })
})
