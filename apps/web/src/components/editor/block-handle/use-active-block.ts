import { useSyncExternalStore } from 'react'
import type { EditorView } from 'prosemirror-view'
import type { ActiveBlockInfo } from '../prosemirror/block-resolve'
import { getActiveBlockSnapshot, subscribeActiveBlock } from './active-block-store'
import { useEditorStore } from '@/lib/editor-store'

export function useActiveBlock(view: EditorView | null): ActiveBlockInfo | null {
  const isEditorFocused = useEditorStore((s) => s.isEditorFocused)

  return useSyncExternalStore(
    (onStoreChange) => {
      if (!view || !isEditorFocused) return () => {}
      return subscribeActiveBlock(view, onStoreChange)
    },
    () => {
      if (!view || !isEditorFocused) return null
      return getActiveBlockSnapshot(view)
    },
    () => null
  )
}
