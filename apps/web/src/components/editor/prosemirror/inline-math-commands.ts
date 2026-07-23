import { NodeSelection, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { getProtectedZoneRanges, rangeOverlapsProtectedZone } from '../ai/ai-zone-protection'

function selectionIsPlainInlineText(view: EditorView): boolean {
  const { from, to, $from, $to } = view.state.selection
  if (from >= to || !$from.sameParent($to) || !$from.parent.inlineContent) return false
  let plain = true
  view.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText && !node.isBlock) plain = false
    return plain
  })
  return plain
}

/** Turns a text selection into an equation, or an exact equation selection back into source text. */
export function toggleInlineMath(view: EditorView): boolean {
  const { state } = view
  const { selection } = state

  if (selection instanceof NodeSelection && selection.node.type.name === 'math_inline') {
    if (rangeOverlapsProtectedZone(getProtectedZoneRanges(view), selection.from, selection.to)) return false
    const latex = String(selection.node.attrs.latex ?? '')
    const tr = state.tr.delete(selection.from, selection.to)
    if (latex) {
      tr.insertText(latex, selection.from)
      tr.setSelection(TextSelection.create(tr.doc, selection.from, selection.from + latex.length))
    } else {
      tr.setSelection(TextSelection.create(tr.doc, selection.from))
    }
    tr.scrollIntoView()
    view.dispatch(tr)
    view.focus()
    return true
  }

  if (!selectionIsPlainInlineText(view)) return false
  if (rangeOverlapsProtectedZone(getProtectedZoneRanges(view), selection.from, selection.to)) return false
  const math = state.schema.nodes.math_inline
  if (!math) return false
  const source = state.doc.textBetween(selection.from, selection.to, '', '')
  const wrapped = source.match(/^\$([^$\n]+)\$$/)
  const latex = wrapped ? wrapped[1] : source
  if (!latex.trim() || /[\r\n]/.test(latex)) return false

  const tr = state.tr.replaceWith(selection.from, selection.to, math.create({ latex }))
  tr.setSelection(NodeSelection.create(tr.doc, selection.from)).scrollIntoView()
  view.dispatch(tr)
  view.focus()
  return true
}
