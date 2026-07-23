import { NodeSelection, Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'
import type { Node as ProseMirrorNode } from 'prosemirror-model'

export type MathEntryEdge = 'start' | 'end'

interface MathNavigationState {
  pos: number
  entryEdge: MathEntryEdge
}

export const mathNavigationPluginKey = new PluginKey<MathNavigationState | null>('math-navigation')

function isMathNode(node: ProseMirrorNode | null | undefined): boolean {
  return node?.type.name === 'math_inline' || node?.type.name === 'math_block'
}

function selectMath(view: import('prosemirror-view').EditorView, pos: number, entryEdge: MathEntryEdge) {
  const tr = view.state.tr
    .setSelection(NodeSelection.create(view.state.doc, pos))
    .setMeta(mathNavigationPluginKey, { pos, entryEdge } satisfies MathNavigationState)
  view.dispatch(tr)
  return true
}

function adjacentInlineMath(state: EditorState, direction: -1 | 1): number | null {
  const selection = state.selection
  if (!(selection instanceof TextSelection) || !selection.empty) return null
  const $head = selection.$head
  const node = direction > 0 ? $head.nodeAfter : $head.nodeBefore
  if (!node || node.type.name !== 'math_inline') return null
  return direction > 0 ? $head.pos : $head.pos - node.nodeSize
}

function adjacentBlockMath(state: EditorState, direction: -1 | 1): number | null {
  const selection = state.selection
  if (!(selection instanceof TextSelection) || !selection.empty) return null
  const $head = selection.$head
  if (!$head.parent.isTextblock) return null

  if (direction > 0) {
    if ($head.parentOffset !== $head.parent.content.size) return null
    const afterBlock = $head.after($head.depth)
    return state.doc.nodeAt(afterBlock)?.type.name === 'math_block' ? afterBlock : null
  }

  if ($head.parentOffset !== 0) return null
  const beforeBlock = $head.before($head.depth)
  const $boundary = state.doc.resolve(beforeBlock)
  const node = $boundary.nodeBefore
  return node?.type.name === 'math_block' ? beforeBlock - node.nodeSize : null
}

/** Routes keyboard caret movement into atomic equations with a known source edge. */
export function createMathNavigationPlugin(): Plugin<MathNavigationState | null> {
  return new Plugin<MathNavigationState | null>({
    key: mathNavigationPluginKey,
    state: {
      init: (): MathNavigationState | null => null,
      apply(tr, previous: MathNavigationState | null) {
        const explicit = tr.getMeta(mathNavigationPluginKey) as MathNavigationState | undefined
        if (explicit) return explicit

        if (tr.selection instanceof NodeSelection && isMathNode(tr.selection.node)) {
          // A mouse click defaults to appending; source edits retain the edge
          // that originally opened the editor so controlled rerenders do not
          // move the DOM input caret.
          if (previous?.pos === tr.selection.from) return previous
          return { pos: tr.selection.from, entryEdge: 'end' }
        }
        return null
      },
    },
    props: {
      handleKeyDown(view, event) {
        if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
          return false
        }

        if (event.key === 'ArrowRight') {
          const pos = adjacentInlineMath(view.state, 1)
          if (pos === null) return false
          event.preventDefault()
          return selectMath(view, pos, 'start')
        }
        if (event.key === 'ArrowLeft') {
          const pos = adjacentInlineMath(view.state, -1)
          if (pos === null) return false
          event.preventDefault()
          return selectMath(view, pos, 'end')
        }
        if (event.key === 'ArrowDown') {
          const pos = adjacentBlockMath(view.state, 1)
          if (pos === null) return false
          event.preventDefault()
          return selectMath(view, pos, 'start')
        }
        if (event.key === 'ArrowUp') {
          const pos = adjacentBlockMath(view.state, -1)
          if (pos === null) return false
          event.preventDefault()
          return selectMath(view, pos, 'end')
        }
        return false
      },
    },
  })
}

export function getMathEntryEdge(state: EditorState, pos: number): MathEntryEdge {
  const navigation = mathNavigationPluginKey.getState(state)
  return navigation?.pos === pos ? navigation.entryEdge : 'end'
}
