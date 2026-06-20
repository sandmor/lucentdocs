import { describe, expect, test } from 'bun:test'
import { schema, type JsonObject } from '@lucentdocs/shared'
import {
  buildAnnotatedPromptContextExcerpt,
  extractAnnotationIdsFromMarkers,
  renderAnnotatedDocumentMarkdown,
  type AiAnnotationNote,
} from './annotation-context.js'

function note(
  id: string,
  blockId: string,
  placement: AiAnnotationNote['placement']
): AiAnnotationNote {
  return {
    id,
    blockId,
    placement,
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: `content for ${id}` }] }],
    } as JsonObject,
    createdAt: id.charCodeAt(id.length - 1),
    updatedAt: id.charCodeAt(id.length - 1),
  }
}

function makeDoc() {
  return schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create({ id: 'block-a' }, schema.text('Alpha paragraph.')),
    schema.nodes.paragraph.create({ id: 'block-b' }, schema.text('Beta paragraph.')),
  ])
}

function makeLongDoc() {
  const children = [
    schema.nodes.paragraph.create({ id: 'block-a' }, schema.text('Alpha paragraph.')),
  ]
  for (let index = 0; index < 200; index += 1) {
    children.push(
      schema.nodes.paragraph.create(
        { id: `filler-${index}` },
        schema.text(`Filler paragraph ${index}.`)
      )
    )
  }
  children.push(schema.nodes.paragraph.create({ id: 'block-b' }, schema.text('Beta paragraph.')))
  return schema.nodes.doc.create(null, children)
}

describe('extractAnnotationIdsFromMarkers', () => {
  test('collects self-closing and wrapping markers', () => {
    const text = `<annotation id="n1" />\n<annotation id="n2">\ntext\n</annotation>`
    expect(extractAnnotationIdsFromMarkers(text)).toEqual(new Set(['n1', 'n2']))
  })

  test('unescapes attribute values', () => {
    const text = '<annotation id="n&quot;1">'
    expect(extractAnnotationIdsFromMarkers(text)).toEqual(new Set(['n"1']))
  })

  test('returns an empty set for text without markers', () => {
    expect(extractAnnotationIdsFromMarkers('plain prose')).toEqual(new Set())
  })
})

describe('annotation context rendering', () => {
  test('wraps about notes and inserts inter-block markers', () => {
    const rendered = renderAnnotatedDocumentMarkdown(makeDoc(), [
      note('n-about', 'block-a', 'about'),
      note('n-after', 'block-a', 'after'),
      note('n-before', 'block-b', 'before'),
    ])

    expect(rendered.markdown).toContain('<annotation id="n1">')
    expect(rendered.markdown).toContain('Alpha paragraph.')
    expect(rendered.markdown).toContain('</annotation>')
    expect(rendered.markdown).toContain('<annotation id="n2" />')
    expect(rendered.markdown).toContain('<annotation id="n3" />')
    expect(rendered.annotationContent).toContain('<annotation_content id="n1">')
    expect(rendered.annotationContent).toContain('content for n-after')
    expect(rendered.annotationContent).toContain('content for n-before')
  })

  test('omits orphaned notes', () => {
    const rendered = renderAnnotatedDocumentMarkdown(makeDoc(), [
      note('n-missing', 'missing', 'about'),
    ])

    expect(rendered.markdown).not.toContain('n-missing')
    expect(rendered.annotationContent).toBe('(none)')
  })

  test('adds annotation markers to bounded prompt context', () => {
    const doc = makeDoc()
    const result = buildAnnotatedPromptContextExcerpt(doc, 1, 1, 12_000, [
      note('n-about', 'block-a', 'about'),
    ])

    expect(result.parts.before).toBe('')
    expect(result.parts.after).toContain('<annotation id="n1">')
    expect(result.parts.after).toContain('Alpha paragraph.')
    expect(result.annotationContent).toContain('<annotation_content id="n1">')
  })

  test('omits distant block annotations outside the excerpt window', () => {
    const doc = makeLongDoc()
    const caretPos = doc.content.size - 1
    const result = buildAnnotatedPromptContextExcerpt(doc, caretPos, caretPos, 100, [
      note('real-note-id', 'block-a', 'about'),
    ])

    expect(result.parts.before).not.toContain('<annotation id="n1">')
    expect(result.parts.after ?? '').not.toContain('<annotation id="n1">')
    expect(result.annotationContent).toBe('(none)')
  })
})
