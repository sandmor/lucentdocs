import { describe, expect, test } from 'bun:test'
import { Node as ProseMirrorNode } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { schema } from '@lucentdocs/shared'
import {
  canApplyFormatMark,
  isInCodeBlock,
  selectionTouchesCodeBlock,
  shouldShowSelectionCompose,
} from './utils'
import type { SelectionRange } from '../selection/types'

function viewFromDoc(doc: ProseMirrorNode, selectionPos: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, selectionPos),
  })
  return { state } as EditorView
}

describe('isInCodeBlock', () => {
  test('returns true when the cursor is inside a code block', () => {
    const doc = schema.node('doc', null, [
      schema.node('code_block', { language: 'rust' }, [schema.text('fn main()')]),
    ])
    const view = viewFromDoc(doc, 2)
    expect(isInCodeBlock(view)).toBe(true)
  })

  test('returns false for paragraph selections', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('hello')])])
    const view = viewFromDoc(doc, 2)
    expect(isInCodeBlock(view)).toBe(false)
  })
})

describe('selectionTouchesCodeBlock', () => {
  test('returns true for a non-empty selection inside a code block', () => {
    const doc = schema.node('doc', null, [
      schema.node('code_block', null, [schema.text('fn main()')]),
    ])
    const view = viewFromDoc(doc, 2)
    expect(selectionTouchesCodeBlock(view, 2, 5)).toBe(true)
  })

  test('returns true when a selection spans into a code block', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('before')]),
      schema.node('code_block', null, [schema.text('code')]),
    ])
    const view = viewFromDoc(doc, 2)
    expect(selectionTouchesCodeBlock(view, 2, 6)).toBe(false)
    expect(selectionTouchesCodeBlock(view, 2, 10)).toBe(true)
  })
})

describe('shouldShowSelectionCompose', () => {
  test('returns false for selections inside code blocks', () => {
    const doc = schema.node('doc', null, [schema.node('code_block', null, [schema.text('code')])])
    const view = viewFromDoc(doc, 2)
    const selection: SelectionRange = { from: 2, to: 5 }
    expect(shouldShowSelectionCompose(view, selection)).toBe(false)
  })

  test('returns true for paragraph selections', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('text')])])
    const view = viewFromDoc(doc, 2)
    const selection: SelectionRange = { from: 2, to: 5 }
    expect(shouldShowSelectionCompose(view, selection)).toBe(true)
  })
})

describe('canApplyFormatMark', () => {
  test('disables inline marks inside code blocks', () => {
    const doc = schema.node('doc', null, [schema.node('code_block', null, [schema.text('code')])])
    const view = viewFromDoc(doc, 2)
    expect(canApplyFormatMark(view, 'strong')).toBe(false)
    expect(canApplyFormatMark(view, 'code')).toBe(false)
  })

  test('allows inline marks in paragraphs', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('text')])])
    const view = viewFromDoc(doc, 2)
    expect(canApplyFormatMark(view, 'strong')).toBe(true)
  })
})
