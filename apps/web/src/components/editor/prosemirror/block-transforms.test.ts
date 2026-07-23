import { describe, expect, test } from 'bun:test'
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { schema } from '@lucentdocs/shared'
import { collectDeletedTopLevelBlockIds } from '../notes/note-reconcile'
import { supportsTurnInto, supportsTurnIntoMath } from './block-resolve'
import { fromCodeBlockToParagraph, toCodeBlock, toParagraph } from './block-transforms'
import { handleBlockAction } from './block-actions'

function createView(node: PMNode) {
  const doc = schema.nodes.doc.create(null, [node])
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, 1) })
  let focusCalls = 0

  const view = {
    get state() {
      return state
    },
    dispatch(tr: Transaction) {
      state = state.apply(tr)
    },
    focus() {
      focusCalls += 1
    },
    nodeDOM() {
      return null
    },
  } as unknown as EditorView

  return { view, getState: () => state, getFocusCalls: () => focusCalls }
}

describe('block turn-into transforms', () => {
  test('supports all direct textblock sources, including headings', () => {
    expect(supportsTurnInto(schema.nodes.paragraph.create())).toBe(true)
    expect(supportsTurnInto(schema.nodes.heading.create({ level: 1 }))).toBe(true)
    expect(supportsTurnInto(schema.nodes.code_block.create())).toBe(true)
    expect(supportsTurnInto(schema.nodes.math_block.create())).toBe(true)
    expect(supportsTurnInto(schema.nodes.blockquote.create())).toBe(false)
    expect(supportsTurnInto(schema.nodes.bullet_list.create())).toBe(false)
    expect(supportsTurnInto(schema.nodes.note_marker.create())).toBe(false)
  })

  test('only promotes plain paragraph and code content into equations', () => {
    expect(supportsTurnIntoMath(schema.nodes.paragraph.create())).toBe(true)
    expect(supportsTurnIntoMath(schema.nodes.code_block.create())).toBe(true)
    expect(supportsTurnIntoMath(schema.nodes.heading.create({ level: 1 }))).toBe(false)
    expect(supportsTurnIntoMath(schema.nodes.math_block.create())).toBe(false)
  })

  test('turning fenced text into an equation removes one display fence pair', () => {
    const paragraph = schema.nodes.paragraph.create({ id: 'math-1' }, schema.text('$$\n\\frac{a}{b}\n$$'))
    const { view, getState } = createView(paragraph)

    handleBlockAction(view, 'turn-into-math', {
      pos: 0,
      node: paragraph,
      dom: {} as HTMLElement,
    })

    expect(getState().doc.firstChild?.toJSON()).toEqual({
      type: 'math_block',
      attrs: { latex: '\\frac{a}{b}', id: 'math-1' },
    })
  })

  test('converts a heading to a paragraph without losing its identity or inline formatting', () => {
    const strong = schema.marks.strong.create()
    const heading = schema.nodes.heading.create(
      { level: 2, id: 'heading-1' },
      schema.text('Heading', [strong])
    )
    const { view, getFocusCalls, getState } = createView(heading)

    expect(toParagraph(view)).toBe(true)
    expect(getState().doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'heading-1' },
          content: [{ type: 'text', marks: [{ type: 'strong' }], text: 'Heading' }],
        },
      ],
    })
    expect(getFocusCalls()).toBe(1)
  })

  test('converts a heading to a code block while retaining its block id', () => {
    const heading = schema.nodes.heading.create(
      { level: 3, id: 'heading-code-1' },
      schema.text('const heading = true')
    )
    const { view, getState } = createView(heading)

    expect(toCodeBlock(view)).toBe(true)
    expect(getState().doc.firstChild?.toJSON()).toEqual({
      type: 'code_block',
      attrs: { language: '', id: 'heading-code-1' },
      content: [{ type: 'text', text: 'const heading = true' }],
    })
  })

  test('converts paragraph content to code while retaining line breaks, image text, and the block id', () => {
    const paragraph = schema.nodes.paragraph.create({ id: 'paragraph-1' }, [
      schema.text('alpha'),
      schema.nodes.hard_break.create(),
      schema.text('beta'),
      schema.nodes.image.create({ src: 'diagram.png', alt: 'diagram', title: null }),
    ])
    const { view, getState } = createView(paragraph)

    expect(toCodeBlock(view)).toBe(true)
    expect(getState().doc.firstChild?.toJSON()).toEqual({
      type: 'code_block',
      attrs: { language: '', id: 'paragraph-1' },
      content: [{ type: 'text', text: 'alpha\nbetadiagram' }],
    })
  })

  test('converts multiline code to paragraph hard breaks without changing its anchor id', () => {
    const code = schema.nodes.code_block.create(
      { language: 'ts', id: 'code-1' },
      schema.text('const a = 1\n\nconst b = 2')
    )
    const before = schema.nodes.doc.create(null, [code])
    const { view, getState } = createView(code)

    expect(fromCodeBlockToParagraph(view)).toBe(true)
    expect(getState().doc.firstChild?.toJSON()).toEqual({
      type: 'paragraph',
      attrs: { id: 'code-1' },
      content: [
        { type: 'text', text: 'const a = 1' },
        { type: 'hard_break' },
        { type: 'hard_break' },
        { type: 'text', text: 'const b = 2' },
      ],
    })
    expect(collectDeletedTopLevelBlockIds(before, getState().doc)).toEqual([])
  })
})
