import type { EditorView } from 'prosemirror-view'
import {
  isActiveBlockInDoc,
  resolveActiveBlockFromView,
  type ActiveBlockInfo,
} from '../prosemirror/block-resolve'
import { subscribeEditorView } from '../prosemirror/view-store'

interface ActiveBlockCacheEntry {
  pos: number
  snapshot: ActiveBlockInfo | null
}

const activeBlockCache = new WeakMap<EditorView, ActiveBlockCacheEntry>()

/**
 * Returns a stable ActiveBlockInfo reference while the resolved block is unchanged.
 * Required for useSyncExternalStore — a fresh object each snapshot causes infinite re-renders.
 */
export function getActiveBlockSnapshot(view: EditorView): ActiveBlockInfo | null {
  const resolved = resolveActiveBlockFromView(view)

  if (!resolved) {
    activeBlockCache.set(view, { pos: -1, snapshot: null })
    return null
  }

  const cached = activeBlockCache.get(view)
  if (
    cached?.snapshot &&
    cached.pos === resolved.pos &&
    cached.snapshot.node.type === resolved.node.type &&
    isActiveBlockInDoc(view, cached.snapshot)
  ) {
    return cached.snapshot
  }

  activeBlockCache.set(view, { pos: resolved.pos, snapshot: resolved })
  return resolved
}

export function subscribeActiveBlock(view: EditorView, listener: () => void): () => void {
  return subscribeEditorView(view, listener)
}
