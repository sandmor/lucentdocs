import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'

export const blockDragPluginKey = new PluginKey('block-drag')

let draggedBlockPos: number | null = null
let draggedBlockNode: PMNode | null = null

export function setDraggedBlock(pos: number | null, node: PMNode | null): void {
  draggedBlockPos = pos
  draggedBlockNode = node
}

export function getDraggedBlock(): { pos: number; node: PMNode } | null {
  if (draggedBlockPos === null || !draggedBlockNode) return null
  return { pos: draggedBlockPos, node: draggedBlockNode }
}

export function clearDraggedBlock(): void {
  draggedBlockPos = null
  draggedBlockNode = null
}

function resolveInsertPos(
  view: import('prosemirror-view').EditorView,
  event: DragEvent
): number | null {
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (!coords) return null

  const targetPos = coords.pos
  const $pos = view.state.doc.resolve(targetPos)

  if ($pos.depth > 0) {
    const nodePos = $pos.before(1)
    const dom = view.nodeDOM(nodePos)
    if (dom instanceof HTMLElement) {
      const rect = dom.getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      return event.clientY > midY ? $pos.after(1) : $pos.before(1)
    }
    return $pos.after(0)
  }

  return targetPos
}

function createDropDecoration(doc: PMNode, insertPos: number): DecorationSet {
  return DecorationSet.create(doc, [
    Decoration.widget(
      insertPos,
      () => {
        const div = document.createElement('div')
        div.className = 'block-drop-indicator'
        div.setAttribute('aria-hidden', 'true')
        return div
      },
      { key: 'block-drop-cursor' }
    ),
  ])
}

export const blockDragPlugin = new Plugin({
  key: blockDragPluginKey,
  state: {
    init() {
      return { decoration: DecorationSet.empty }
    },
    apply(tr, value) {
      value.decoration = value.decoration.map(tr.mapping, tr.doc)
      const meta = tr.getMeta(blockDragPluginKey)
      if (meta?.type === 'update') {
        return { decoration: meta.decoration as DecorationSet }
      }
      return value
    },
  },
  props: {
    decorations(state) {
      return this.getState(state)?.decoration ?? DecorationSet.empty
    },
    handleDOMEvents: {
      dragover(view, event) {
        if (!draggedBlockNode) return false
        event.preventDefault()

        const insertPos = resolveInsertPos(view, event)
        if (insertPos === null) return false

        view.dispatch(
          view.state.tr.setMeta(blockDragPluginKey, {
            type: 'update',
            decoration: createDropDecoration(view.state.doc, insertPos),
          })
        )
        return true
      },
      dragleave(view, event) {
        if (!draggedBlockNode) return false
        const related = event.relatedTarget
        if (related instanceof Node && view.dom.contains(related)) return false
        view.dispatch(
          view.state.tr.setMeta(blockDragPluginKey, {
            type: 'update',
            decoration: DecorationSet.empty,
          })
        )
        return false
      },
      drop(view, event) {
        if (!draggedBlockNode || draggedBlockPos === null) return false
        event.preventDefault()

        view.dispatch(
          view.state.tr.setMeta(blockDragPluginKey, {
            type: 'update',
            decoration: DecorationSet.empty,
          })
        )

        const insertPos = resolveInsertPos(view, event)
        if (insertPos === null) {
          clearDraggedBlock()
          return true
        }

        const sourcePos = draggedBlockPos
        const sourceSize = draggedBlockNode.nodeSize

        if (insertPos === sourcePos || insertPos === sourcePos + sourceSize) {
          clearDraggedBlock()
          return true
        }

        const tr = view.state.tr
        tr.delete(sourcePos, sourcePos + sourceSize)
        const mappedInsertPos = tr.mapping.map(insertPos)
        tr.insert(mappedInsertPos, draggedBlockNode)
        tr.scrollIntoView()
        view.dispatch(tr)
        clearDraggedBlock()
        return true
      },
      dragend() {
        clearDraggedBlock()
        return false
      },
    },
  },
})
