import { describe, expect, test } from 'bun:test'
import { Node as ProseMirrorNode } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { parseMarkdownishToSlice } from './markdownish.js'
import { schema } from '@lucentdocs/shared'

function createParagraphDoc(text: string): ProseMirrorNode {
  return schema.node('doc', null, [schema.node('paragraph', null, text ? [schema.text(text)] : [])])
}

function applyMarkdownAtCursor(
  doc: ProseMirrorNode,
  cursorPos: number,
  markdownish: string
): ProseMirrorNode {
  const state = EditorState.create({ doc })
  const $pos = state.doc.resolve(cursorPos)
  const slice = parseMarkdownishToSlice(markdownish, {
    openStart: $pos.parent.inlineContent,
    openEnd: $pos.parent.inlineContent,
  })

  const tr = state.tr.replaceRange(cursorPos, cursorPos, slice)
  return tr.doc
}

function paragraphTexts(doc: ProseMirrorNode): string[] {
  return doc.content.content
    .filter((node) => node.type.name === 'paragraph')
    .map((node) => node.textBetween(0, node.content.size, '\n', '\n'))
}

function findTextPos(doc: ProseMirrorNode, text: string): number {
  const fullText = doc.textBetween(0, doc.content.size, '\n', '\n')
  const index = fullText.indexOf(text)
  if (index < 0) {
    throw new Error(`Text not found: ${text}`)
  }

  return 1 + index
}

describe('parseMarkdownishToSlice', () => {
  test('parses nested GFM task items into the shared task-list attributes', () => {
    const slice = parseMarkdownishToSlice(
      ['- [x] shipped', '  - [ ] write tests', '- plain item'].join('\n')
    )

    expect(slice.content.toJSON()).toEqual([
      {
        type: 'bullet_list',
        attrs: { kind: 'task', id: null },
        content: [
          {
            type: 'list_item',
            attrs: { checked: true },
            content: [
              {
                type: 'paragraph',
                attrs: { id: null },
                content: [{ type: 'text', text: 'shipped' }],
              },
              {
                type: 'bullet_list',
                attrs: { kind: 'task', id: null },
                content: [
                  {
                    type: 'list_item',
                    attrs: { checked: false },
                    content: [
                      {
                        type: 'paragraph',
                        attrs: { id: null },
                        content: [{ type: 'text', text: 'write tests' }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: 'list_item',
            attrs: { checked: false },
            content: [
              {
                type: 'paragraph',
                attrs: { id: null },
                content: [{ type: 'text', text: 'plain item' }],
              },
            ],
          },
        ],
      },
    ])
  })

  test('does not create a new paragraph for plain inline continuation', () => {
    const doc = createParagraphDoc('ripe apple')
    const cursorPos = findTextPos(doc, 'apple')
    const next = applyMarkdownAtCursor(doc, cursorPos, 'plump cherry')

    expect(next.childCount).toBe(1)
    expect(next.firstChild?.type.name).toBe('paragraph')
    expect(next.textBetween(0, next.content.size, '\n', '\n')).toContain('ripe plump cherryapple')
  })

  test('merges first and last paragraph while preserving middle paragraphs', () => {
    const doc = createParagraphDoc('Hello world')
    const cursorPos = findTextPos(doc, 'world')
    const next = applyMarkdownAtCursor(doc, cursorPos, 'bright dawn\n\nmiddle beat\n\nfinal tone')

    expect(paragraphTexts(next)).toEqual(['Hello bright dawn', 'middle beat', 'final toneworld'])
  })

  test('keeps inline markdown marks when inserted at paragraph boundary', () => {
    const doc = createParagraphDoc('alpha omega')
    const cursorPos = findTextPos(doc, 'omega')
    const next = applyMarkdownAtCursor(doc, cursorPos, '**bold** and _soft_ ')

    expect(next.childCount).toBe(1)
    const paragraph = next.firstChild!
    const boldNode = paragraph.content.content.find((node) => node.text === 'bold')
    const italicNode = paragraph.content.content.find((node) => node.text === 'soft')

    expect(boldNode?.marks.some((mark) => mark.type.name === 'strong')).toBe(true)
    expect(italicNode?.marks.some((mark) => mark.type.name === 'em')).toBe(true)
  })
})
