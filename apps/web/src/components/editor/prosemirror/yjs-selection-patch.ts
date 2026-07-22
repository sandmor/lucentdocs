import type { EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import {
  absolutePositionToRelativePosition,
  getRelativeSelection,
  ySyncPluginKey,
} from 'y-prosemirror'
import { getViewRootSelection } from '../selection/root-selection'

interface RelativeSelectionSnapshot {
  type: string
  anchor: unknown
  head: unknown
}

interface AbsoluteSelectionSnapshot {
  anchor: number
  head: number
}

interface YSyncBindingPatchTarget {
  prosemirrorView: EditorView | null
  beforeTransactionSelection: RelativeSelectionSnapshot | null
  beforeAllTransactions: () => void
  afterAllTransactions: () => void
  _isLocalCursorInView: () => boolean
  type: unknown
  mapping: unknown
  __lucentdocsSelectionPatchApplied?: boolean
  __lucentdocsAbsoluteSelectionBeforeRemoteTx?: AbsoluteSelectionSnapshot | null
}

export function consumeAbsoluteSelectionSnapshotBeforeRemoteTx(
  state: EditorState
): AbsoluteSelectionSnapshot | null {
  const syncState = ySyncPluginKey.getState(state) as
    | { binding?: YSyncBindingPatchTarget }
    | undefined
  const binding = syncState?.binding
  if (!binding) return null

  const snapshot = binding.__lucentdocsAbsoluteSelectionBeforeRemoteTx ?? null
  binding.__lucentdocsAbsoluteSelectionBeforeRemoteTx = null
  return snapshot
}

function getAbsoluteSelectionFromDOM(view: EditorView): AbsoluteSelectionSnapshot | null {
  const domSelection = getViewRootSelection(view)
  if (
    !domSelection ||
    domSelection.rangeCount === 0 ||
    !domSelection.anchorNode ||
    !domSelection.focusNode
  ) {
    return null
  }

  if (!view.dom.contains(domSelection.anchorNode) || !view.dom.contains(domSelection.focusNode)) {
    return null
  }

  try {
    const anchor = view.posAtDOM(domSelection.anchorNode, domSelection.anchorOffset, 1)
    const head = view.posAtDOM(domSelection.focusNode, domSelection.focusOffset, -1)
    return { anchor, head }
  } catch {
    return null
  }
}

function getRelativeSelectionFromDOM(
  binding: YSyncBindingPatchTarget
): RelativeSelectionSnapshot | null {
  const view = binding.prosemirrorView
  if (!view) return null

  const absolute = getAbsoluteSelectionFromDOM(view)
  if (!absolute) return null

  binding.__lucentdocsAbsoluteSelectionBeforeRemoteTx = absolute

  return {
    type: (view.state.selection as typeof view.state.selection & { jsonID: string }).jsonID,
    anchor: absolutePositionToRelativePosition(
      absolute.anchor,
      binding.type as never,
      binding.mapping as never
    ),
    head: absolutePositionToRelativePosition(
      absolute.head,
      binding.type as never,
      binding.mapping as never
    ),
  }
}

/**
 * y-prosemirror restores a relative selection and may scroll it into view on every
 * remote Yjs document update. That is normally acceptable for collaborative typing,
 * but it is wrong for AI zone streaming writes: the AI mutates the document, not the
 * client's caret or viewport.
 *
 * This patch narrows the behavior in two ways:
 * 1. snapshot the real DOM selection before remote Yjs transactions, so we preserve
 *    what the user actually selected instead of stale ProseMirror state
 * 2. disable the plugin's remote auto-scroll path so streamed writes do not yank the viewport
 *
 * The patch is intentionally applied to the ySync binding instance after EditorState
 * creation, because the binding is owned by y-prosemirror internals.
 */
export function installYjsSelectionPatch(state: EditorState): void {
  const syncState = ySyncPluginKey.getState(state) as
    | { binding?: YSyncBindingPatchTarget }
    | undefined
  const binding = syncState?.binding
  if (!binding || binding.__lucentdocsSelectionPatchApplied) return

  binding.__lucentdocsSelectionPatchApplied = true
  binding.__lucentdocsAbsoluteSelectionBeforeRemoteTx = null
  const originalAfterAllTransactions = binding.afterAllTransactions

  binding.beforeAllTransactions = () => {
    if (binding.beforeTransactionSelection !== null || binding.prosemirrorView == null) {
      return
    }

    const relativeFromDom = getRelativeSelectionFromDOM(binding)
    if (relativeFromDom) {
      binding.beforeTransactionSelection = relativeFromDom
      return
    }

    const view = binding.prosemirrorView
    if (view) {
      binding.__lucentdocsAbsoluteSelectionBeforeRemoteTx = {
        anchor: view.state.selection.anchor,
        head: view.state.selection.head,
      }
    }

    binding.beforeTransactionSelection = getRelativeSelection(
      binding as Parameters<typeof getRelativeSelection>[0],
      binding.prosemirrorView.state
    )
  }

  binding.afterAllTransactions = () => {
    originalAfterAllTransactions()
    binding.__lucentdocsAbsoluteSelectionBeforeRemoteTx = null
  }

  binding._isLocalCursorInView = () => false
}
