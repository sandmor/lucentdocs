import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'

export interface ActiveBlockInfo {
  node: PMNode
  pos: number
  dom: HTMLElement
}

export type BlockActionId =
  | 'insert-paragraph'
  | 'insert-code'
  | 'insert-unordered-list'
  | 'insert-ordered-list'
  | 'insert-task-list'
  | 'add-note'
  | 'turn-into-note'
  | 'turn-into-paragraph'
  | 'turn-into-code'
  | 'turn-into-unordered-list'
  | 'turn-into-ordered-list'
  | 'turn-into-task-list'
  | 'move-up'
  | 'move-down'
  | 'duplicate'
  | 'delete'

const TURN_INTO_SOURCE_TYPES = new Set(['paragraph', 'heading', 'code_block'])
const LIST_BLOCK_TYPES = new Set(['bullet_list', 'ordered_list', 'list_item'])

export function isListBlockType(typeName: string): boolean {
  return LIST_BLOCK_TYPES.has(typeName)
}

export function resolveBlockAtPos(view: EditorView, docPos: number): ActiveBlockInfo | null {
  const { doc } = view.state
  const clampedPos = Math.max(0, Math.min(docPos, doc.content.size))
  const $pos = doc.resolve(clampedPos)

  let foundNode: PMNode | null = null
  let foundPos: number | null = null

  if ($pos.depth >= 1) {
    foundNode = $pos.node(1)
    foundPos = $pos.before(1)
  } else if ($pos.depth === 0) {
    const nodeAfter = $pos.nodeAfter
    if (nodeAfter?.isBlock) {
      foundNode = nodeAfter
      foundPos = $pos.pos
    } else {
      const nodeBefore = $pos.nodeBefore
      if (nodeBefore?.isBlock) {
        foundNode = nodeBefore
        foundPos = $pos.pos - nodeBefore.nodeSize
      }
    }
  }

  if (!foundNode || foundPos === null) return null

  const dom = resolveBlockDom(view, foundPos)
  if (!dom) return null

  return { node: foundNode, pos: foundPos, dom }
}

export function resolveActiveBlockFromView(view: EditorView): ActiveBlockInfo | null {
  const { $from } = view.state.selection
  return resolveBlockAtPos(view, $from.pos)
}

function getBlockVerticalBounds(
  view: EditorView,
  blockPos: number,
  nodeSize: number
): { top: number; bottom: number } | null {
  const doc = view.state.doc
  const startPos = Math.min(blockPos + 1, doc.content.size)
  const endPos = Math.min(blockPos + nodeSize - 1, doc.content.size)

  try {
    const start = view.coordsAtPos(startPos)
    const end = view.coordsAtPos(Math.max(startPos, endPos))
    return {
      top: Math.min(start.top, end.top),
      bottom: Math.max(start.bottom, end.bottom),
    }
  } catch {
    const dom = resolveBlockDom(view, blockPos)
    if (!dom || typeof dom.getBoundingClientRect !== 'function') return null
    const rect = dom.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom }
  }
}

/**
 * Resolves the top-level block at a viewport Y coordinate.
 * Used for desktop gutter/canvas hover where posAtCoords does not hit document content.
 */
export function resolveActiveBlockFromClientY(
  view: EditorView,
  clientY: number
): ActiveBlockInfo | null {
  const { doc } = view.state
  let pos = 0
  let nearest: { info: ActiveBlockInfo; distance: number } | null = null

  for (let index = 0; index < doc.childCount; index += 1) {
    const node = doc.child(index)
    const blockPos = pos
    const nodeSize = node.nodeSize
    pos += nodeSize

    const bounds = getBlockVerticalBounds(view, blockPos, nodeSize)
    if (!bounds) continue

    const dom = resolveBlockDom(view, blockPos)
    if (!dom) continue

    const info: ActiveBlockInfo = { node, pos: blockPos, dom }

    if (clientY >= bounds.top && clientY <= bounds.bottom) {
      return info
    }

    const distance = clientY < bounds.top ? bounds.top - clientY : clientY - bounds.bottom
    if (!nearest || distance < nearest.distance) {
      nearest = { info, distance }
    }
  }

  return nearest?.info ?? null
}

function resolveBlockDom(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.nodeDOM(pos)
  if (typeof HTMLElement !== 'undefined' && dom instanceof HTMLElement) return dom
  if (dom && typeof dom === 'object' && 'isConnected' in dom) {
    return dom as HTMLElement
  }

  const domAtPos = view.domAtPos(pos)
  if (typeof HTMLElement !== 'undefined' && domAtPos.node instanceof HTMLElement)
    return domAtPos.node
  if (domAtPos.node.parentElement instanceof HTMLElement) return domAtPos.node.parentElement

  return null
}

export function getBlockIndex(doc: PMNode, pos: number): number {
  const $pos = doc.resolve(pos)
  return $pos.index(0)
}

export function canMoveBlockUp(doc: PMNode, pos: number): boolean {
  return getBlockIndex(doc, pos) > 0
}

export function canMoveBlockDown(doc: PMNode, pos: number, nodeSize: number): boolean {
  const index = getBlockIndex(doc, pos)
  const endPos = pos + nodeSize
  const $after = doc.resolve(Math.min(endPos, doc.content.size))
  return index < $after.parent.childCount - 1
}

export function supportsTurnInto(node: PMNode): boolean {
  if (node.type.name === 'note_marker') return false
  return TURN_INTO_SOURCE_TYPES.has(node.type.name)
}

export function supportsListTurnInto(node: PMNode): boolean {
  return (
    TURN_INTO_SOURCE_TYPES.has(node.type.name) ||
    node.type.name === 'bullet_list' ||
    node.type.name === 'ordered_list'
  )
}

export function isActiveBlockInDoc(view: EditorView, info: ActiveBlockInfo): boolean {
  if (!info.dom.isConnected) return false
  const resolved = resolveBlockAtPos(view, info.pos + 1)
  if (!resolved || resolved.pos !== info.pos) return false
  if (resolved.dom !== info.dom) return false
  return view.state.doc.nodeAt(info.pos)?.type === info.node.type
}

export function refreshActiveBlock(
  view: EditorView,
  info: ActiveBlockInfo
): ActiveBlockInfo | null {
  if (!isActiveBlockInDoc(view, info)) return null
  return resolveBlockAtPos(view, info.pos + 1)
}
