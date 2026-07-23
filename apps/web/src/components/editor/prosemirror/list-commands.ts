import { liftListItem, sinkListItem, splitListItemKeepMarks } from 'prosemirror-schema-list'
import { Plugin, TextSelection, type Command } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { hasRecognizedMarkdownSyntax, parseMarkdownishToSlice, schema } from '@lucentdocs/shared'

export type ListKind = 'bullet' | 'ordered' | 'task'

function listTypeFor(kind: ListKind) {
  return kind === 'ordered' ? schema.nodes.ordered_list : schema.nodes.bullet_list
}

function listAttrs(kind: ListKind, id: string | null = null) {
  if (kind === 'ordered') return { order: 1, id }
  return { kind: kind === 'task' ? 'task' : 'bullet', id }
}

function itemAttrs(kind: ListKind) {
  return { checked: kind === 'task' ? false : null }
}

function blockId(node: PMNode): string | null {
  return typeof node.attrs.id === 'string' && node.attrs.id.length > 0 ? node.attrs.id : null
}

export function listKindForNode(node: PMNode): ListKind | null {
  if (node.type === schema.nodes.ordered_list) return 'ordered'
  if (node.type === schema.nodes.bullet_list) {
    return node.attrs.kind === 'task' ? 'task' : 'bullet'
  }
  return null
}

export function isListNode(node: PMNode): boolean {
  return listKindForNode(node) !== null
}

function listItemContext(doc: PMNode, pos: number) {
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.type === schema.nodes.list_item) {
      const listDepth = depth - 1
      const list = listDepth > 0 ? $pos.node(listDepth) : null
      if (!list || !isListNode(list)) return null
      return {
        $pos,
        item: node,
        itemPos: $pos.before(depth),
        list,
        listPos: $pos.before(listDepth),
      }
    }
  }
  return null
}

export function isSelectionInList(state: Parameters<Command>[0]): boolean {
  return Boolean(listItemContext(state.doc, state.selection.$from.pos))
}

export function canIndentListItem(state: Parameters<Command>[0]): boolean {
  return sinkListItem(schema.nodes.list_item)(state)
}

export function canOutdentListItem(state: Parameters<Command>[0]): boolean {
  return liftListItem(schema.nodes.list_item)(state)
}

function normalizeNestedTaskLists(tr: import('prosemirror-state').Transaction) {
  let next = tr
  tr.doc.descendants((node, pos) => {
    if (node.type !== schema.nodes.bullet_list || node.attrs.kind === 'task') return true

    let hasTaskItem = false
    node.forEach((item) => {
      if (item.type === schema.nodes.list_item && typeof item.attrs.checked === 'boolean') {
        hasTaskItem = true
      }
    })
    if (!hasTaskItem) return true

    next = next.setNodeMarkup(pos, undefined, { ...node.attrs, kind: 'task' })
    return true
  })
  return next
}

export const indentListItem: Command = (state, dispatch) => {
  if (!dispatch) return sinkListItem(schema.nodes.list_item)(state)
  return sinkListItem(schema.nodes.list_item)(state, (tr) => dispatch(normalizeNestedTaskLists(tr)))
}

export const outdentListItem: Command = (state, dispatch) =>
  liftListItem(schema.nodes.list_item)(state, dispatch)

export const splitListItem: Command = (state, dispatch) => {
  const context = listItemContext(state.doc, state.selection.$from.pos)
  if (!context) return false
  return splitListItemKeepMarks(
    schema.nodes.list_item,
    itemAttrs(listKindForNode(context.list) ?? 'bullet')
  )(state, dispatch)
}

export const exitEmptyListItem: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty || $from.parentOffset !== 0 || $from.parent.content.size !== 0) return false
  return outdentListItem(state, dispatch)
}

export const toggleTaskListItem: Command = (state, dispatch) => {
  const context = listItemContext(state.doc, state.selection.$from.pos)
  if (!context || listKindForNode(context.list) !== 'task') return false
  if (!dispatch) return true

  dispatch(
    state.tr.setNodeMarkup(context.itemPos, undefined, {
      ...context.item.attrs,
      checked: context.item.attrs.checked !== true,
    })
  )
  return true
}

export function toggleTaskListItemAtPos(view: EditorView, pos: number): boolean {
  const context = listItemContext(view.state.doc, pos)
  if (!context || listKindForNode(context.list) !== 'task') return false
  view.dispatch(
    view.state.tr.setNodeMarkup(context.itemPos, undefined, {
      ...context.item.attrs,
      checked: context.item.attrs.checked !== true,
    })
  )
  return true
}

/** Keeps task-list invariants intact for input rules, paste, and collaboration. */
export function createTaskListNormalizationPlugin(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _oldState, state) {
      if (!transactions.some((tr) => tr.docChanged)) return null

      let tr = state.tr
      let changed = false
      state.doc.descendants((node, pos) => {
        if (node.type !== schema.nodes.bullet_list) return true

        let hasTaskItem = false
        node.forEach((item, offset) => {
          if (item.type !== schema.nodes.list_item) return
          if (typeof item.attrs.checked === 'boolean') {
            hasTaskItem = true
            return
          }
          if (node.attrs.kind === 'task') {
            tr = tr.setNodeMarkup(pos + 1 + offset, undefined, { ...item.attrs, checked: false })
            changed = true
          }
        })
        if (node.attrs.kind !== 'task' && hasTaskItem) {
          tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, kind: 'task' })
          changed = true
        }
        return true
      })

      return changed ? tr : null
    },
    props: {
      handleClick(view, pos, event) {
        const target = event.target
        if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return false
        const item = target.closest('li')
        if (!item) return false

        event.preventDefault()
        const itemPos = view.posAtDOM(item, 0)
        return toggleTaskListItemAtPos(view, Math.max(pos, itemPos + 1))
      },
    },
  })
}

function isLucentClipboardHtml(html: string): boolean {
  return /data-(?:math-inline|math-block|block-id|note-marker|ai-zone)/.test(html)
}

/**
 * Upgrades recognizably Markdown plain text on paste. Internal Lucent HTML is
 * intentionally left to ProseMirror's DOM parser so rich copies stay rich.
 */
export function createMarkdownClipboardPlugin(options: { target?: 'document' | 'note' } = {}): Plugin {
  const target = options.target ?? 'document'
  return new Plugin({
    props: {
      handlePaste(view, event) {
        if (view.state.selection.$from.parent.type.name === 'code_block') return false
        const text = event.clipboardData?.getData('text/plain') ?? ''
        if (!text || !hasRecognizedMarkdownSyntax(text, target)) return false

        const html = event.clipboardData?.getData('text/html') ?? ''
        if (html && isLucentClipboardHtml(html)) return false

        event.preventDefault()
        const { $from, $to } = view.state.selection
        view.dispatch(
          view.state.tr
            .replaceSelection(
              parseMarkdownishToSlice(text, {
                openStart: $from.parent.inlineContent,
                openEnd: $to.parent.inlineContent,
                target,
              })
            )
            .scrollIntoView()
        )
        return true
      },
    },
  })
}

function paragraphContentForList(node: PMNode): PMNode[] {
  const paragraph = schema.nodes.paragraph
  if (node.type === paragraph) return node.content.content.slice()

  const hardBreak = schema.nodes.hard_break
  const content: PMNode[] = []
  const lines = node.textContent.split(/\r\n?|\n/)
  lines.forEach((line, index) => {
    if (line) content.push(schema.text(line))
    if (index < lines.length - 1 && hardBreak) content.push(hardBreak.create())
  })
  return content
}

export function turnBlockIntoList(
  view: EditorView,
  pos: number,
  node: PMNode,
  kind: ListKind
): boolean {
  const { state, dispatch } = view
  const targetType = listTypeFor(kind)
  if (!targetType) return false

  const currentKind = listKindForNode(node)
  if (currentKind) {
    if (currentKind === kind) return true

    let tr = state.tr.setNodeMarkup(pos, targetType, listAttrs(kind, blockId(node)))
    node.forEach((child, offset) => {
      if (child.type !== schema.nodes.list_item) return
      tr = tr.setNodeMarkup(pos + 1 + offset, undefined, {
        ...child.attrs,
        ...itemAttrs(kind),
      })
    })
    dispatch(tr.scrollIntoView())
    view.focus()
    return true
  }

  if (!node.isTextblock) return false
  const paragraph = schema.nodes.paragraph
  const item = schema.nodes.list_item
  if (!paragraph || !item) return false

  const listItem = item.create(
    itemAttrs(kind),
    paragraph.create(null, paragraphContentForList(node))
  )
  const list = targetType.create(listAttrs(kind, blockId(node)), listItem)
  const tr = state.tr.replaceWith(pos, pos + node.nodeSize, list)
  tr.setSelection(TextSelection.create(tr.doc, pos + 3))
  dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

export function insertListAfterBlock(
  view: EditorView,
  pos: number,
  node: PMNode,
  kind: ListKind
): boolean {
  const listType = listTypeFor(kind)
  const paragraph = schema.nodes.paragraph
  const item = schema.nodes.list_item
  if (!listType || !paragraph || !item) return false

  const list = listType.create(listAttrs(kind), item.create(itemAttrs(kind), paragraph.create()))
  const insertPos = pos + node.nodeSize
  const tr = view.state.tr.insert(insertPos, list)
  tr.setSelection(TextSelection.create(tr.doc, insertPos + 3))
  dispatchListTransaction(view, tr)
  return true
}

function dispatchListTransaction(view: EditorView, tr: import('prosemirror-state').Transaction) {
  tr.scrollIntoView()
  view.dispatch(tr)
  view.focus()
}
