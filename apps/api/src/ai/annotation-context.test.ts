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
  anchorId: string,
  anchorKind: AiAnnotationNote['anchorKind']
): AiAnnotationNote {
  return {
    id,
    anchorId,
    anchorKind,
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

function makeDocWithMarker() {
  return schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create({ id: 'block-a' }, schema.text('Alpha paragraph.')),
    schema.nodes.note_marker.create({ id: 'marker-1' }),
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
  test('wraps block notes and inserts marker note annotations', () => {
    const rendered = renderAnnotatedDocumentMarkdown(makeDocWithMarker(), [
      note('n-block', 'block-a', 'block'),
      note('n-marker', 'marker-1', 'marker'),
    ])

    expect(rendered.markdown).toContain('<annotation id="n1">')
    expect(rendered.markdown).toContain('Alpha paragraph.')
    expect(rendered.markdown).toContain('</annotation>')
    expect(rendered.markdown).toContain('<annotation id="n2" />')
    expect(rendered.annotationContent).toContain('<annotation_content id="n1">')
    expect(rendered.annotationContent).toContain('content for n-marker')
  })

  test('omits orphaned notes', () => {
    const rendered = renderAnnotatedDocumentMarkdown(makeDoc(), [
      note('n-missing', 'missing', 'block'),
    ])

    expect(rendered.markdown).not.toContain('n-missing')
    expect(rendered.annotationContent).toBe('(none)')
  })

  test('adds annotation markers to bounded prompt context', () => {
    const doc = makeDoc()
    const result = buildAnnotatedPromptContextExcerpt(doc, 1, 1, 12_000, [
      note('n-block', 'block-a', 'block'),
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
      note('real-note-id', 'block-a', 'block'),
    ])

    expect(result.parts.before).not.toContain('<annotation id="n1">')
    expect(result.parts.after ?? '').not.toContain('<annotation id="n1">')
    expect(result.annotationContent).toBe('(none)')
  })
})
