import {
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useState,
  useCallback,
  useMemo,
} from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { initProseMirrorDoc } from 'y-prosemirror'
import { toast } from 'sonner'
import { schema } from '@lucentdocs/shared'
import {
  buildPlugins,
  finalizeCollaborationState,
  type ProsemirrorMapping,
} from './prosemirror/plugins'
import { createAIWriterController, type AIWriterController } from './ai/writer'
import { InlineAIControls } from './inline/controls'
import { useAIWriterState } from './inline/hooks'
import { RemotePresenceOverlay } from './collaboration/remote-presence-overlay'
import { createAIBubbleNodeViews } from './collaboration/ai-bubble-node-view'
import { createCodeBlockNodeView } from './nodes/code-block-node-view'
import { AIBubblePresenceStore } from './collaboration/ai-bubble-presence'
import { SelectionFakeOverlay } from './selection/fake-overlay'
import type { SelectionRange } from './selection/types'
import { SearchResultMarkers, type SearchResultMarker } from './search-result-markers'
import { emitAIStateChange } from './ai/writer-store'
import { getSelectionRangeInView, hasActiveDomSelection } from './selection/dom-selection'
import { selectionTouchesCodeBlock, shouldShowSelectionCompose } from './inline/utils'
import { useInlineSessions } from './inline/use-sessions'
import { useInlineSessionObserver } from './inline/use-inline-session-observer'
import { resolveObservedInlineSessionIds } from './inline/resolve-observed-inline-session-ids'
import { getAIZones } from './ai/writer-plugin'
import { emitEditorViewChange } from './prosemirror/view-store'
import { getLocalPresenceUser, installLocalPresenceUser } from './prosemirror/presence'
import { createYjsProvider, type ConnectionStatus } from '@/lib/yjs-provider'
import { useEditorStore } from '@/lib/editor-store'

export interface EditorHandle {
  startAIContinuation: (at_doc_end: boolean) => void
  scrollToRange: (from: number, to: number, options?: { select?: boolean }) => void
}

function findScrollParent(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element.parentElement

  while (current) {
    const style = window.getComputedStyle(current)
    const overflowY = style.overflowY
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      current.scrollHeight > current.clientHeight
    ) {
      return current
    }
    current = current.parentElement
  }

  return null
}

function forceSelectionIntoViewport(view: EditorView, position: number): void {
  const anchorPosition = Math.max(1, Math.min(position, view.state.doc.content.size))
  const coords = view.coordsAtPos(anchorPosition)
  const scrollParent = findScrollParent(view.dom)
  const padding = 96

  if (scrollParent) {
    const parentRect = scrollParent.getBoundingClientRect()
    if (coords.top < parentRect.top + padding) {
      scrollParent.scrollTop += coords.top - parentRect.top - padding
      return
    }
    if (coords.bottom > parentRect.bottom - padding) {
      scrollParent.scrollTop += coords.bottom - parentRect.bottom + padding
    }
    return
  }

  const viewportHeight = window.innerHeight
  if (coords.top < padding) {
    window.scrollBy({ top: coords.top - padding, behavior: 'auto' })
    return
  }
  if (coords.bottom > viewportHeight - padding) {
    window.scrollBy({ top: coords.bottom - viewportHeight + padding, behavior: 'auto' })
  }
}

function scrollSelectedDomRangeIntoView(): void {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return

  const range = selection.getRangeAt(0)
  const anchorNode = range.startContainer
  const anchorElement =
    anchorNode instanceof HTMLElement
      ? anchorNode
      : anchorNode.parentElement instanceof HTMLElement
        ? anchorNode.parentElement
        : null

  if (!anchorElement) return

  const scrollParent = findScrollParent(anchorElement)
  if (!scrollParent) {
    anchorElement.scrollIntoView({ block: 'center', inline: 'nearest' })
    return
  }

  const parentRect = scrollParent.getBoundingClientRect()
  const elementRect = anchorElement.getBoundingClientRect()
  const targetTop =
    scrollParent.scrollTop +
    (elementRect.top - parentRect.top) -
    (parentRect.height - elementRect.height) / 2

  scrollParent.scrollTo({ top: Math.max(0, targetTop), behavior: 'auto' })
}

function scrollElementIntoNearestView(element: HTMLElement): void {
  const scrollParent = findScrollParent(element)
  if (!scrollParent) {
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
    return
  }

  const parentRect = scrollParent.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  const targetTop =
    scrollParent.scrollTop +
    (elementRect.top - parentRect.top) -
    (parentRect.height - elementRect.height) / 2

  scrollParent.scrollTo({ top: Math.max(0, targetTop), behavior: 'auto' })
}

function scrollEditorPositionIntoView(view: EditorView, position: number): void {
  const targetPosition = Math.max(1, Math.min(position, view.state.doc.content.size))
  const domAtPos = view.domAtPos(targetPosition)
  const element =
    domAtPos.node instanceof HTMLElement
      ? domAtPos.node
      : domAtPos.node.parentElement instanceof HTMLElement
        ? domAtPos.node.parentElement
        : null

  if (!element) return
  scrollElementIntoNearestView(element)
}

interface EditorProps {
  projectId?: string
  documentId: string
  onConnectionChange?: (status: ConnectionStatus) => void
  className?: string
  searchResultMarkers?: SearchResultMarker[]
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { projectId, documentId, onConnectionChange, className, searchResultMarkers = [] },
  ref
) {
  const [editorShell, setEditorShell] = useState<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const selectionToolbarInteractingRef = useRef(false)
  const aiControllerRef = useRef<AIWriterController | null>(null)
  const providerRef = useRef<ReturnType<typeof createYjsProvider> | null>(null)
  const bubblePresenceRef = useRef<AIBubblePresenceStore | null>(null)
  const hasShownOfflineToastRef = useRef(false)

  const setStoreEditorView = useEditorStore((s) => s.setEditorView)
  const setStoreConnectionStatus = useEditorStore((s) => s.setConnectionStatus)
  const setStoreIsGenerating = useEditorStore((s) => s.setIsGenerating)
  const setStoreEditorSelection = useEditorStore((s) => s.setEditorSelection)
  const setStoreSelectionRange = useEditorStore((s) => s.setSelectionRange)
  const setStoreIsEditorFocused = useEditorStore((s) => s.setIsEditorFocused)

  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [providerSessionKey, setProviderSessionKey] = useState(0)
  const [presenceAwareness, setPresenceAwareness] = useState<
    ReturnType<typeof createYjsProvider>['awareness'] | null
  >(null)

  // Selection range also needed as local state for overlay components
  const [selectionRange, setSelectionRange] = useState<SelectionRange | null>(null)
  const [isEditorFocused, setIsEditorFocused] = useState(false)

  const aiState = useAIWriterState(editorView)
  useInlineSessions({
    projectId,
    documentId,
    aiState,
  })

  const sessionStreamMetaById = useEditorStore((s) => s.inlineSessionStreamMetaById)

  const inlineSessionIds = useMemo(
    () => resolveObservedInlineSessionIds(aiState, sessionStreamMetaById),
    [aiState, sessionStreamMetaById]
  )

  const resolveZoneIdForSession = useCallback(
    (sessionId: string) => {
      if (!editorView) return null
      const zone = getAIZones(editorView).find((entry) => entry.sessionId === sessionId)
      if (zone) return zone.id
      const pluginState = aiState
      if (pluginState?.sessionId === sessionId && pluginState.zoneId) {
        return pluginState.zoneId
      }
      return null
    },
    [aiState, editorView]
  )

  useInlineSessionObserver({
    projectId,
    documentId,
    sessionIds: inlineSessionIds,
    resolveZoneIdForSession,
    getBubblePresence: () => bubblePresenceRef.current,
  })

  const showOfflineToast = useCallback(() => {
    if (!hasShownOfflineToastRef.current) {
      toast.error('Connection lost. Changes may not be saved.', {
        duration: Infinity,
        id: 'yjs-offline',
      })
      hasShownOfflineToastRef.current = true
    }
  }, [])

  const dismissOfflineToast = useCallback(() => {
    toast.dismiss('yjs-offline')
    hasShownOfflineToastRef.current = false
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    let destroyed = false

    const handleConnectionChange = (status: ConnectionStatus) => {
      if (destroyed) return
      onConnectionChange?.(status)
      setStoreConnectionStatus(status)

      if (status === 'connected') {
        dismissOfflineToast()
      } else if (status === 'disconnected') {
        showOfflineToast()
      }
    }

    const provider = createYjsProvider(
      documentId,
      handleConnectionChange,
      () => {
        if (destroyed) return
        setIsLoading(false)
      },
      () => {
        if (destroyed) return
        setProviderSessionKey((value) => value + 1)
      }
    )
    providerRef.current = provider
    const bubblePresence = new AIBubblePresenceStore(provider.awareness)
    bubblePresenceRef.current = bubblePresence
    installLocalPresenceUser(provider.awareness, getLocalPresenceUser(provider.doc.clientID))

    const aiController = createAIWriterController({
      onStreamingChange(streaming) {
        setStoreIsGenerating(streaming)
      },
      getToolScope() {
        return {
          projectId,
          documentId,
        }
      },
      getRequesterClientName() {
        const clientId = providerRef.current?.doc.clientID
        if (typeof clientId !== 'number') return null
        return `yjs_client_${clientId}`
      },
      getSessionById(sessionId) {
        return useEditorStore.getState().inlineSessionsById[sessionId] ?? null
      },
      setSessionById(sessionId, session) {
        useEditorStore.getState().setSessionById(sessionId, session)
      },
      bubblePresence,
    })
    aiControllerRef.current = aiController

    const type = provider.type
    const { doc: pmDoc, mapping } = initProseMirrorDoc(type, schema)

    const state = EditorState.create({
      doc: pmDoc,
      plugins: buildPlugins({
        collaboration: {
          yjsFragment: type,
          yjsMapping: mapping as ProsemirrorMapping,
        },
        aiHandlers: {
          onAccept() {
            if (viewRef.current) aiController.acceptAI(viewRef.current)
          },
          onReject() {
            if (viewRef.current) aiController.rejectAI(viewRef.current)
          },
          onCancelAI(view, options) {
            aiController.cancelAI(view, options)
          },
        },
      }),
    })
    finalizeCollaborationState(state)

    const view = new EditorView(containerRef.current, {
      state,
      scrollThreshold: 150,
      scrollMargin: 150,
      nodeViews: {
        ...createAIBubbleNodeViews(bubblePresence),
        ...createCodeBlockNodeView(),
      },
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr)
        view.updateState(newState)

        emitEditorViewChange(view)
        emitAIStateChange(view)

        const { from, to, empty } = newState.selection
        const viewIsFocused = view.hasFocus()
        const interacting = selectionToolbarInteractingRef.current

        // Only update store if selection actually changed (not just on every transaction)
        if (tr.selectionSet || !useEditorStore.getState().editorSelection) {
          setStoreEditorSelection({ from, to })
        }

        // Only update focus state if it changed
        if (viewIsFocused !== useEditorStore.getState().isEditorFocused) {
          setStoreIsEditorFocused(viewIsFocused)
          setIsEditorFocused(viewIsFocused)
        }

        // Compute selection range for inline AI controls
        const nextSelectionRange = ((): SelectionRange | null => {
          if (!empty) {
            if (!viewIsFocused && !interacting) {
              return null
            }
            if (selectionTouchesCodeBlock(view, from, to)) {
              return null
            }
            return { from, to }
          }

          if (interacting) {
            const previous = useEditorStore.getState().selectionRange
            if (previous) {
              if (!tr.docChanged) {
                return previous
              }
              const mappedFrom = tr.mapping.map(previous.from, 1)
              const mappedTo = tr.mapping.map(previous.to, -1)
              if (mappedFrom < mappedTo && !selectionTouchesCodeBlock(view, mappedFrom, mappedTo)) {
                return { from: mappedFrom, to: mappedTo }
              }
            }
          }

          return null
        })()

        const prevRange = useEditorStore.getState().selectionRange
        if (
          !prevRange ||
          !nextSelectionRange ||
          prevRange.from !== nextSelectionRange.from ||
          prevRange.to !== nextSelectionRange.to
        ) {
          setStoreSelectionRange(nextSelectionRange)
          setSelectionRange(nextSelectionRange)
        }
      },
    })

    viewRef.current = view
    queueMicrotask(() => {
      if (!destroyed) {
        setPresenceAwareness(provider.awareness)
      }
    })
    setEditorView(view)
    setStoreEditorView(view)
    setStoreEditorSelection({
      from: view.state.selection.from,
      to: view.state.selection.to,
    })
    setStoreIsEditorFocused(view.hasFocus())
    setIsEditorFocused(view.hasFocus())

    const syncSelectionFromDOM = () => {
      if (destroyed) return

      const selection = getSelectionRangeInView(view)
      if (!selection || selection.empty) {
        if (view.hasFocus() && !selectionToolbarInteractingRef.current) {
          const prevRange = useEditorStore.getState().selectionRange
          if (prevRange !== null) {
            setStoreSelectionRange(null)
            setSelectionRange(null)
          }
        }
        return
      }

      if (selectionTouchesCodeBlock(view, selection.from, selection.to)) {
        const prevRange = useEditorStore.getState().selectionRange
        if (prevRange !== null) {
          setStoreSelectionRange(null)
          setSelectionRange(null)
        }
        return
      }

      const prevRange = useEditorStore.getState().selectionRange
      if (!prevRange || prevRange.from !== selection.from || prevRange.to !== selection.to) {
        setStoreSelectionRange({ from: selection.from, to: selection.to })
        setSelectionRange({ from: selection.from, to: selection.to })
      }
    }

    const handleViewFocusIn = () => {
      if (!useEditorStore.getState().isEditorFocused) {
        setStoreIsEditorFocused(true)
        setIsEditorFocused(true)
      }
    }
    const handleViewFocusOut = () => {
      if (useEditorStore.getState().isEditorFocused) {
        setStoreIsEditorFocused(false)
        setIsEditorFocused(false)
      }
    }
    view.dom.addEventListener('focusin', handleViewFocusIn)
    view.dom.addEventListener('focusout', handleViewFocusOut)
    document.addEventListener('selectionchange', syncSelectionFromDOM)
    view.dom.addEventListener('mouseup', syncSelectionFromDOM)

    const loadingTimeout = setTimeout(() => {
      if (!provider.isSynced()) {
        setIsLoading(false)
      }
    }, 3000)

    return () => {
      destroyed = true
      clearTimeout(loadingTimeout)

      aiController.detachAI()
      aiControllerRef.current = null
      bubblePresenceRef.current?.destroy()
      bubblePresenceRef.current = null

      if (providerRef.current) {
        providerRef.current.disconnect()
        providerRef.current = null
      }

      view.dom.removeEventListener('focusin', handleViewFocusIn)
      view.dom.removeEventListener('focusout', handleViewFocusOut)
      document.removeEventListener('selectionchange', syncSelectionFromDOM)
      view.dom.removeEventListener('mouseup', syncSelectionFromDOM)
      view.destroy()
      viewRef.current = null
      setPresenceAwareness(null)
      setEditorView(null)
      setStoreEditorView(null)
      setStoreEditorSelection(null)
      setStoreSelectionRange(null)
      setStoreIsEditorFocused(false)
      setIsLoading(true)
      setStoreIsGenerating(false)
      useEditorStore.getState().setSessions(() => ({}))
      selectionToolbarInteractingRef.current = false
    }
  }, [
    projectId,
    documentId,
    providerSessionKey,
    showOfflineToast,
    dismissOfflineToast,
    onConnectionChange,
    setStoreEditorView,
    setStoreConnectionStatus,
    setStoreIsGenerating,
    setStoreEditorSelection,
    setStoreSelectionRange,
    setStoreIsEditorFocused,
  ])

  useImperativeHandle(ref, () => ({
    startAIContinuation(at_doc_end: boolean) {
      if (!viewRef.current) return
      aiControllerRef.current?.startAIContinuation(viewRef.current, at_doc_end)
    },
    scrollToRange(from: number, to: number, options?: { select?: boolean }) {
      if (!viewRef.current) return
      const doc = viewRef.current.state.doc
      const max = doc.content.size
      if (max <= 0) return

      const resolvedFrom = Math.max(1, Math.min(from, max))
      const resolvedTo = Math.max(resolvedFrom, Math.min(to, max))
      const shouldSelect = options?.select ?? true

      const tr = viewRef.current.state.tr
      tr.setSelection(
        TextSelection.create(doc, resolvedFrom, shouldSelect ? resolvedTo : resolvedFrom)
      )
      tr.scrollIntoView()
      viewRef.current.dispatch(tr)
      viewRef.current.focus()

      let attemptsRemaining = 4
      const settleScroll = () => {
        requestAnimationFrame(() => {
          if (!viewRef.current) return
          scrollEditorPositionIntoView(
            viewRef.current,
            shouldSelect ? Math.floor((resolvedFrom + resolvedTo) / 2) : resolvedFrom
          )
          if (shouldSelect) scrollSelectedDomRangeIntoView()
          forceSelectionIntoViewport(viewRef.current, resolvedFrom)
          attemptsRemaining -= 1
          if (attemptsRemaining > 0) {
            settleScroll()
          }
        })
      }

      settleScroll()
    },
  }))

  const handleToolbarInteractionChange = useCallback(
    (interacting: boolean) => {
      selectionToolbarInteractingRef.current = interacting
      if (interacting || !viewRef.current) return

      if (!hasActiveDomSelection(viewRef.current)) {
        setStoreSelectionRange(null)
        setSelectionRange(null)
        return
      }

      const { from, to, empty } = viewRef.current.state.selection
      const next = empty ? null : { from, to }
      if (next && selectionTouchesCodeBlock(viewRef.current, next.from, next.to)) {
        setStoreSelectionRange(null)
        setSelectionRange(null)
        return
      }
      setStoreSelectionRange(next)
      setSelectionRange(next)
    },
    [setStoreSelectionRange]
  )

  return (
    <div ref={setEditorShell} className="relative flex-1 flex flex-col">
      <div ref={containerRef} className={className} />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80">
          <div className="w-3/4 space-y-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      )}
      <InlineAIControls
        view={editorView}
        selection={selectionRange}
        onGenerate={(prompt, selection) => {
          if (!viewRef.current || !aiControllerRef.current) return false
          if (!shouldShowSelectionCompose(viewRef.current, selection)) return false
          const started = aiControllerRef.current.startAIPromptAtRange(
            viewRef.current,
            prompt,
            selection.from,
            selection.to
          )
          if (!started) return false

          selectionToolbarInteractingRef.current = false

          const docSize = viewRef.current.state.doc.content.size
          const collapsePos = Math.max(0, Math.min(selection.to, docSize))
          const tr = viewRef.current.state.tr.setSelection(
            TextSelection.create(viewRef.current.state.doc, collapsePos)
          )
          tr.setMeta('addToHistory', false)
          viewRef.current.dispatch(tr)

          return true
        }}
        onAccept={(zoneId) => {
          if (viewRef.current) aiControllerRef.current?.acceptAI(viewRef.current, zoneId)
        }}
        onReject={(zoneId) => {
          if (viewRef.current) aiControllerRef.current?.rejectAI(viewRef.current, zoneId)
        }}
        onStop={(zoneId) => {
          if (!viewRef.current || !aiControllerRef.current) return
          aiControllerRef.current.cancelAI(viewRef.current, { preserveDoc: true, zoneId })
        }}
        onContinuePrompt={(zoneId, prompt) => {
          if (!viewRef.current || !aiControllerRef.current) return false
          return aiControllerRef.current.continueAIPromptForZone(viewRef.current, zoneId, prompt)
        }}
        onDismissChoices={(zoneId) => {
          if (!viewRef.current || !aiControllerRef.current) return false
          return aiControllerRef.current.dismissChoicesForZone(viewRef.current, zoneId)
        }}
        onInteractionChange={handleToolbarInteractionChange}
      />
      <RemotePresenceOverlay view={editorView} awareness={presenceAwareness} />
      <SearchResultMarkers
        view={editorView}
        container={editorShell}
        markers={searchResultMarkers}
      />
      <SelectionFakeOverlay
        view={editorView}
        selection={selectionRange}
        visible={Boolean(
          editorView &&
          selectionRange &&
          !isEditorFocused &&
          shouldShowSelectionCompose(editorView, selectionRange)
        )}
      />
    </div>
  )
})
