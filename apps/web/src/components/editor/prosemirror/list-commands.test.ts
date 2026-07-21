import { describe, expect, test } from 'bun:test'
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state'
import { schema } from '@lucentdocs/shared'
import { indentListItem, splitListItem } from './list-commands.js'

describe('task-list commands', () => {
  test('keeps a nested task list when splitting an item', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'bullet_list',
          attrs: { kind: 'task' },
          content: [
            {
              type: 'list_item',
              attrs: { checked: false },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Parent' }] },
                {
                  type: 'bullet_list',
                  attrs: { kind: 'task' },
                  content: [
                    {
                      type: 'list_item',
                      attrs: { checked: false },
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Child' }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
    let childPos = 0
    doc.descendants((node, pos) => {
      if (node.isText && node.text === 'Child') childPos = pos + 2
    })
    let state = EditorState.create({ doc, selection: TextSelection.create(doc, childPos) })

    expect(
      splitListItem(state, (tr: Transaction) => {
        state = state.apply(tr)
      })
    ).toBe(true)

    const nestedList = state.doc.firstChild!.firstChild!.lastChild!
    expect(nestedList.attrs.kind).toBe('task')
    expect(nestedList.childCount).toBe(2)
    expect(nestedList.lastChild!.attrs.checked).toBe(false)
  })

  test('keeps task-list semantics when indenting an item into a nested list', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'bullet_list',
          attrs: { kind: 'task' },
          content: [
            {
              type: 'list_item',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }],
            },
            {
              type: 'list_item',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }],
            },
          ],
        },
      ],
    })
    let secondPos = 0
    doc.descendants((node, pos) => {
      if (node.isText && node.text === 'Second') secondPos = pos + 2
    })
    let state = EditorState.create({ doc, selection: TextSelection.create(doc, secondPos) })

    expect(
      indentListItem(state, (tr: Transaction) => {
        state = state.apply(tr)
      })
    ).toBe(true)

    const nestedList = state.doc.firstChild!.firstChild!.lastChild!
    expect(nestedList.type.name).toBe('bullet_list')
    expect(nestedList.attrs.kind).toBe('task')
    expect(nestedList.firstChild!.attrs.checked).toBe(false)
  })
})
