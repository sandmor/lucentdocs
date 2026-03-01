import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom'
import type { InlineZoneSession } from '@plotline/shared'
import { useAnimatedPresence, useMountAnimationPhase, useSelectionComposeController } from './hooks'
import { AIZoneSurface, SelectionComposeSurface } from './surfaces'
import type { InlineControlState } from './types'
import {
  applyPosition,
  COLLISION_PADDING,
  getSelectionRect,
  resolveCollisionPosition,
} from './utils'
import type { SelectionRange } from '../selection/types'
import type { EditorView } from 'prosemirror-view'

interface SelectionComposeFloatingControlProps {
  view: EditorView
  selection: SelectionRange | null
  visible: boolean
  onGenerate: (prompt: string, selection: SelectionRange) => boolean
  onInteractionChange: (interacting: boolean) => void
}

export function SelectionComposeFloatingControl({
  view,
  selection,
  visible,
  onGenerate,
  onInteractionChange,
}: SelectionComposeFloatingControlProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const presence = useAnimatedPresence(visible)

  const anchoredSelection = selection && selection.from < selection.to ? selection : null
  const controls = useSelectionComposeController(view, anchoredSelection, onGenerate)

  useEffect(() => {
    if (!presence.mounted || !anchoredSelection || !rootRef.current) return

    const floating = rootRef.current
    const placements: Placement[] = [
      'top',
      'right',
      'left',
      'bottom',
      'top-start',
      'top-end',
      'right-start',
      'right-end',
      'left-start',
      'left-end',
      'bottom-start',
      'bottom-end',
    ]

    const reference = {
      getBoundingClientRect: () => getSelectionRect(view, anchoredSelection),
      contextElement: view.dom as HTMLElement,
    }

    let cancelled = false
    let rafId = 0

    const updatePosition = async () => {
      if (!rootRef.current || cancelled) return

      const floatingEl = rootRef.current
      let fallbackResult: { x: number; y: number; collides: boolean } | null = null

      for (const placement of placements) {
        try {
          const result = await computePosition(reference, floatingEl, {
            placement,
            middleware: [
              offset(12),
              flip({ fallbackAxisSideDirection: 'start', padding: COLLISION_PADDING }),
              shift({ padding: COLLISION_PADDING, crossAxis: true }),
            ],
          })

          const resolvedResult = resolveCollisionPosition(result.x, result.y, floatingEl)
          if (!fallbackResult) fallbackResult = resolvedResult

          if (!resolvedResult.collides) {
            applyPosition(floatingEl, resolvedResult.x, resolvedResult.y)
            return
          }
        } catch {
          continue
        }
      }

      if (fallbackResult) {
        applyPosition(floatingEl, fallbackResult.x, fallbackResult.y)
      }
    }

    const scheduleUpdate = () => {
      if (cancelled) return
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        void updatePosition()
      })
    }

    scheduleUpdate()

    const floatingResizeObserver = new ResizeObserver(() => {
      scheduleUpdate()
    })
    floatingResizeObserver.observe(floating)

    const editorResizeObserver = new ResizeObserver(() => {
      scheduleUpdate()
    })
    editorResizeObserver.observe(view.dom as HTMLElement)

    window.addEventListener('resize', scheduleUpdate)
    window.addEventListener('scroll', scheduleUpdate, true)

    const controlsObserver = new MutationObserver(() => {
      scheduleUpdate()
    })

    const watchControls = () => {
      controlsObserver.disconnect()
      const zoneControls = document.querySelectorAll<HTMLElement>('.ai-writer-floating-controls')
      for (const control of zoneControls) {
        if (control === floating) continue
        controlsObserver.observe(control, {
          attributes: true,
          attributeFilter: ['style', 'class'],
        })
      }
    }

    watchControls()

    const controlsListObserver = new MutationObserver(() => {
      watchControls()
      scheduleUpdate()
    })
    controlsListObserver.observe(document.body, { childList: true, subtree: true })

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      floatingResizeObserver.disconnect()
      editorResizeObserver.disconnect()
      controlsObserver.disconnect()
      controlsListObserver.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('scroll', scheduleUpdate, true)
    }
  }, [view, anchoredSelection, controls.prompt.length, presence.mounted])

  if (!presence.mounted || !anchoredSelection) return null

  return createPortal(
    <SelectionComposeSurface
      rootRef={rootRef}
      className="ai-inline-controls ai-selection-toolbar ai-inline-animated ai-inline-animated-desktop fixed z-70 flex w-[min(94vw,420px)] flex-col overflow-hidden rounded-xl border border-border bg-background/95 font-sans text-[13px] shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur-md duration-150 dark:shadow-black/40 dark:ring-white/10"
      animationPhase={presence.phase}
      prompt={controls.prompt}
      markActive={controls.markActive}
      onPromptChange={controls.setPrompt}
      onToggleMark={controls.runToggleMark}
      onSubmit={controls.handleSubmit}
      onInteractionChange={onInteractionChange}
      showShortcutHint
    />,
    document.body
  )
}

interface AIZoneFloatingControlProps {
  view: EditorView
  zoneId?: string
  from: number
  to: number
  state: InlineControlState
  stuck: boolean
  session: InlineZoneSession | null
  onAccept: (zoneId?: string) => void
  onReject: (zoneId?: string) => void
  onContinuePrompt: (zoneId: string, prompt: string) => boolean
  onDismissChoices: (zoneId: string) => boolean
}

export function AIZoneFloatingControl({
  view,
  zoneId,
  from,
  to,
  state,
  stuck,
  session,
  onAccept,
  onReject,
  onContinuePrompt,
  onDismissChoices,
}: AIZoneFloatingControlProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const animationPhase = useMountAnimationPhase()

  const getZoneAnchorElement = useCallback((): HTMLElement | null => {
    if (!zoneId) return null

    const escapedId =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(zoneId)
        : zoneId.replace(/["\\]/g, '\\$&')

    const matches = view.dom.querySelectorAll<HTMLElement>(
      `.ai-generating-text[data-ai-zone-id="${escapedId}"]`
    )
    if (matches.length === 0) return null
    return matches[matches.length - 1]
  }, [view, zoneId])

  useEffect(() => {
    if (!rootRef.current) return

    const el = rootRef.current

    const updatePosition = () => {
      const anchorElement = getZoneAnchorElement()

      if (anchorElement) {
        computePosition(anchorElement, el, {
          placement: 'bottom-start',
          middleware: [
            offset(8),
            flip({ fallbackAxisSideDirection: 'end' }),
            shift({ padding: 8 }),
          ],
        }).then(({ x, y }) => {
          el.style.left = `${Math.round(x)}px`
          el.style.top = `${Math.round(y)}px`
        })
        return
      }

      const docSize = view.state.doc.content.size
      const safeFrom = Math.max(0, Math.min(Math.min(from, to), docSize))
      const safeTo = Math.max(0, Math.min(Math.max(from, to), docSize))
      const fallbackPos = Math.max(0, Math.min(safeTo || safeFrom, docSize))
      const coords = view.coordsAtPos(fallbackPos)
      const virtualEl = {
        getBoundingClientRect: () =>
          new DOMRect(coords.left, coords.top, Math.max(1, coords.right - coords.left), 1),
      }

      computePosition(virtualEl, el, {
        placement: 'bottom-start',
        middleware: [offset(8), flip({ fallbackAxisSideDirection: 'end' }), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        el.style.left = `${Math.round(x)}px`
        el.style.top = `${Math.round(y)}px`
      })
    }

    updatePosition()
    const cleanup = autoUpdate(view.dom as HTMLElement, el, updatePosition, {
      animationFrame: true,
    })

    return () => {
      cleanup()
    }
  }, [view, zoneId, from, to, state, stuck, session?.choices.length, getZoneAnchorElement])

  return createPortal(
    <AIZoneSurface
      rootRef={rootRef}
      className="ai-inline-controls ai-writer-floating-controls ai-inline-animated ai-inline-animated-desktop fixed z-60 flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background/95 font-sans text-[13px] shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur-md dark:shadow-black/40 dark:ring-white/10"
      animationPhase={animationPhase}
      zoneId={zoneId}
      state={state}
      stuck={stuck}
      session={session}
      from={from}
      to={to}
      view={view}
      onAccept={onAccept}
      onReject={onReject}
      onContinuePrompt={onContinuePrompt}
      onDismissChoices={onDismissChoices}
    />,
    document.body
  )
}
