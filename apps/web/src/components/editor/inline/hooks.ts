import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { toggleMark } from 'prosemirror-commands'
import type { EditorView } from 'prosemirror-view'
import type { AIWriterState } from '../ai/writer-plugin'
import { getAIStateSnapshot, subscribeAIState } from '../ai/writer-store'
import type { AnimationPhase, FormatMarkName } from './types'
import { isMarkActive, resolveMarkType } from './utils'
import type { SelectionRange } from '../selection/types'

export function useAIWriterState(view: EditorView | null): AIWriterState | null {
  return useSyncExternalStore(
    (cb) => (view ? subscribeAIState(view, cb) : () => {}),
    () => (view ? getAIStateSnapshot(view) : null),
    () => null
  )
}

export function useIsCoarsePointer(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}

      const mediaQuery = window.matchMedia('(pointer: coarse)')
      const handleChange = () => {
        onStoreChange()
      }

      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleChange)
        return () => {
          mediaQuery.removeEventListener('change', handleChange)
        }
      }

      mediaQuery.addListener(handleChange)
      return () => {
        mediaQuery.removeListener(handleChange)
      }
    },
    () => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
      return window.matchMedia('(pointer: coarse)').matches
    },
    () => false
  )
}

export function useVisualViewportBottomOffset(enabled: boolean): number {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!enabled || typeof window === 'undefined') return () => {}

      const viewport = window.visualViewport
      if (!viewport) return () => {}

      viewport.addEventListener('resize', onStoreChange)
      viewport.addEventListener('scroll', onStoreChange)
      window.addEventListener('resize', onStoreChange)

      return () => {
        viewport.removeEventListener('resize', onStoreChange)
        viewport.removeEventListener('scroll', onStoreChange)
        window.removeEventListener('resize', onStoreChange)
      }
    },
    () => {
      if (!enabled || typeof window === 'undefined') return 0
      const viewport = window.visualViewport
      if (!viewport) return 0

      const occludedBottom = window.innerHeight - viewport.height - viewport.offsetTop
      return Math.max(0, Math.round(occludedBottom))
    },
    () => 0
  )
}

export function useAnimatedPresence(visible: boolean, _exitMs = 150) {
  return useMemo(
    () => ({
      mounted: visible,
      phase: (visible ? 'enter' : 'exit') as AnimationPhase,
    }),
    [visible]
  )
}

export function useMountAnimationPhase(): AnimationPhase {
  return 'enter'
}

export function useSelectionComposeController(
  view: EditorView,
  selection: SelectionRange | null,
  onGenerate: (prompt: string, selection: SelectionRange) => boolean
) {
  const [prompt, setPrompt] = useState('')

  const runToggleMark = useCallback(
    (markName: FormatMarkName) => {
      const markType = resolveMarkType(view, markName)
      if (!markType) return

      const { from, to, empty } = view.state.selection
      if (empty || from >= to) return

      const command = toggleMark(markType)
      command(view.state, view.dispatch, view)
      view.focus()
    },
    [view]
  )

  const markActive = {
    strong: isMarkActive(view, 'strong'),
    em: isMarkActive(view, 'em'),
  }

  const handleSubmit = useCallback(() => {
    const trimmed = prompt.trim()
    if (!trimmed || !selection) return

    const started = onGenerate(trimmed, selection)
    if (started) {
      setPrompt('')
    }
  }, [onGenerate, prompt, selection])

  return {
    prompt,
    setPrompt,
    markActive,
    runToggleMark,
    handleSubmit,
  }
}
