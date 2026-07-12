import { describe, expect, test } from 'bun:test'
import { ensureBlockIds, schema } from '@lucentdocs/shared'
import {
  applyDocumentManuscriptEdits,
  assertMarkerAnchorsPreserved,
} from './document-edit-plan.js'
import { projectDocumentManuscript } from './document-manuscript.js'

const BLOCK_ONE = 'block-one'
const BLOCK_TWO = 'block-two'
const MARKER_ONE = 'marker-one'

function makeAnnotatedDoc() {
  return schema.nodeFromJSON(
    ensureBlockIds({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: BLOCK_ONE },
          content: [{ type: 'text', text: 'Alpha paragraph.' }],
        },
        {
          type: 'note_marker',
          attrs: { id: MARKER_ONE },
        },
        {
          type: 'paragraph',
          attrs: { id: BLOCK_TWO },
          content: [
            { type: 'text', text: 'Beta ' },
            { type: 'text', marks: [{ type: 'strong' }], text: 'bold' },
            { type: 'text', text: ' close.' },
          ],
        },
      ],
    })
  )
}

describe('document-edit-plan', () => {
  test('structural paragraph split preserves marker anchors and untouched blocks', () => {
    const doc = makeAnnotatedDoc()
    const manuscript = projectDocumentManuscript(doc)
    const betaParagraph = 'Beta **bold** close.'
    const start = manuscript.indexOf(betaParagraph)
    expect(start).toBeGreaterThan(-1)

    const planned = applyDocumentManuscriptEdits(
      doc,
      [{ start, end: start + betaParagraph.length }],
      'Beta split.\n\nBeta **bold** close.',
      { replaceAll: false }
    )

    assertMarkerAnchorsPreserved(doc, planned.nextDoc, new Set([MARKER_ONE]))

    expect(planned.nextDoc.child(0).textContent).toBe('Alpha paragraph.')
    expect(planned.nextDoc.child(1).type.name).toBe('note_marker')
    expect(planned.nextDoc.childCount).toBeGreaterThan(3)
    expect(projectDocumentManuscript(planned.nextDoc)).toContain('Beta split.')
    expect(projectDocumentManuscript(planned.nextDoc)).toContain('**bold**')
  })

  test('inline replacement preserves block id and surrounding text', () => {
    const doc = makeAnnotatedDoc()
    const manuscript = projectDocumentManuscript(doc)
    const needle = 'Alpha paragraph.'
    const start = manuscript.indexOf(needle)

    const planned = applyDocumentManuscriptEdits(
      doc,
      [{ start, end: start + needle.length }],
      'Omega paragraph.',
      { replaceAll: false }
    )

    expect(planned.nextDoc.child(0).attrs.id).toBe(BLOCK_ONE)
    expect(planned.nextDoc.child(0).textContent).toBe('Omega paragraph.')
    expect(planned.nextDoc.child(2).textContent).toContain('bold')
  })
})
