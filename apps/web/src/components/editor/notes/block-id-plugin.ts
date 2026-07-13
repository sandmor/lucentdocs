import { Plugin, PluginKey } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { BLOCK_ID_NODE_TYPES } from '@lucentdocs/shared'

const blockIdPluginKey = new PluginKey('block-id')

function generateBlockId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`
}

export function createBlockIdPlugin(): Plugin {
  return new Plugin({
    key: blockIdPluginKey,
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) {
        return null
      }

      const seen = new Set<string>()
      let changed = false
      const tr = newState.tr

      newState.doc.descendants((node, pos) => {
        if (!BLOCK_ID_NODE_TYPES.has(node.type.name)) return true

        let id = node.attrs.id as string | null | undefined
        if (typeof id !== 'string' || id.length === 0 || seen.has(id)) {
          let nextId = generateBlockId()
          while (seen.has(nextId)) {
            nextId = generateBlockId()
          }
          id = nextId
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, id })
          changed = true
        }

        seen.add(id)
        return true
      })

      return changed ? tr : null
    },
  })
}

export function getBlockIdAtPos(doc: PMNode, pos: number): string | null {
  const $pos = doc.resolve(pos)
  if ($pos.depth < 1) return null
  const block = $pos.node(1)
  const id = block.attrs.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

if (import.meta.hot) {
  import.meta.hot.accept()
}
