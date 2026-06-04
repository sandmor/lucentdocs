import { describe, expect, test } from 'bun:test'
import { Node as ProseMirrorNode } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import { schema } from '@lucentdocs/shared'
import { handleCodeBlockBackspace } from './code-block-keymap'

function stateAt(doc: ProseMirrorNode, pos: number): EditorState {
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, pos),
  })
}

describe('handleCodeBlockBackspace', () => {
  test('converts an empty code block at the start to a paragraph', () => {
    const doc = schema.node('doc', null, [schema.node('code_block', null)])
    const state = stateAt(doc, 1)
    let applied: EditorState | undefined

    expect(handleCodeBlockBackspace(state, (tr) => {
      applied = state.apply(tr)
    })).toBe(true)
    expect(applied?.doc.firstChild?.type.name).toBe('paragraph')
  })

  test('does not convert a non-empty code block at the start', () => {
    const doc = schema.node('doc', null, [
      schema.node('code_block', null, [schema.text('line')]),
    ])
    const state = stateAt(doc, 1)

    expect(handleCodeBlockBackspace(state)).toBe(false)
    expect(state.doc.firstChild?.type.name).toBe('code_block')
  })
})
