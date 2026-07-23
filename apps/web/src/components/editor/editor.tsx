import {
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useState,
  useCallback,
  useMemo,
} from 'react'
import type * as Y from 'yjs'
import { Skeleton } from '@/components/ui/skeleton'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
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
import { createNoteMarkerNodeView } from './nodes/note-marker-node-view'
import { createMathNodeViews } from './nodes/math-node-view'
import { MathControls } from './nodes/math-controls'
import { AIBubblePresenceStore } from './collaboration/ai-bubble-presence'
import { SelectionFakeOverlay } from './selection/fake-overlay'
import type { SelectionRange } from './selection/types'
import { SearchResultMarkers, type SearchResultMarker } from './search-result-markers'
import { BlockHandle } from './block-handle/block-handle'
import { NotesGutter } from './notes/notes-gutter'
import { SideElementsProvider } from './side-elements/side-elements-context'
import { emitAIStateChange } from './ai/writer-store'
import { getSelectionRangeInView, hasActiveDomSelection } from './selection/dom-selection'
import { selectionTouchesCodeBlock, shouldShowSelectionCompose } from './inline/utils'
import { useInlineSessions } from './inline/use-sessions'
import { useInlineSessionObserver } from './inline/use-inline-session-observer'
import { resolveObservedInlineSessionIds } from './inline/resolve-observed-inline-session-ids'
import { aiWriterPluginKey, getAIZones, sessionIdsWithEndedZoneStreaming } from './ai/writer-plugin'
import { emitEditorViewChange } from './prosemirror/view-store'
import { getMathEntryEdge } from './prosemirror/math-navigation-plugin'
import { toggleInlineMath } from './prosemirror/inline-math-commands'
import {
  getLocalPresenceUser,
  installLocalPresenceUser,
  normalizePresenceUser,
} from './prosemirror/presence'
import { createYjsProvider, type ConnectionStatus } from '@/lib/yjs-provider'
import { useEditorStore } from '@/lib/editor-store'
import { trpc } from '@/lib/trpc'
import {
  DEFAULT_QUOTE_TYPING_PREFERENCES,
  type QuoteTypingPreferences,
} from './prosemirror/quote-typing-plugin'

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
  const quoteTypingPreferencesRef = useRef<QuoteTypingPreferences>(DEFAULT_QUOTE_TYPING_PREFERENCES)
  const selectionToolbarInteractingRef = useRef(false)
  const inlineAIControlsInteractingRef = useRef(false)
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
  const editorPreferencesQuery = trpc.editorPreferences.getDocument.useQuery(
    { projectId: projectId ?? '', id: documentId },
    { enabled: Boolean(projectId && documentId) }
  )
  useEffect(() => {
    if (editorPreferencesQuery.data) {
      quoteTypingPreferencesRef.current = editorPreferencesQuery.data.resolved
    }
  }, [editorPreferencesQuery.data])
  const [isLoading, setIsLoading] = useState(true)
  const [providerSessionKey, setProviderSessionKey] = useState(0)
  const [presenceAwareness, setPresenceAwareness] = useState<
    ReturnType<typeof createYjsProvider>['awareness'] | null
  >(null)
  const [notesMap, setNotesMap] = useState<Y.Map<unknown> | null>(null)
  const [justCreatedNote, setJustCreatedNote] = useState<{ id: string; anchorId: string } | null>(
    null
  )
  const notesMapRef = useRef<Y.Map<unknown> | null>(null)

  // Selection range also needed as local state for overlay components
  const [selectionRange, setSelectionRange] = useState<SelectionRange | null>(null)
  const [isEditorFocused, setIsEditorFocused] = useState(false)
  const [mobileBlockBarInteracting, setMobileBlockBarInteracting] = useState(false)
  const [activeMath, setActiveMath] = useState<{
    pos: number
    node: import('prosemirror-model').Node
    entryEdge: 'start' | 'end'
  } | null>(null)

  const meQuery = trpc.auth.me.useQuery()
  const noteCreatorUserId = meQuery.data?.id ?? 'local'

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
      isInlineAIControlsInteracting() {
        return inlineAIControlsInteractingRef.current
      },
      getCollaboratorDisplayName(clientName) {
        if (!clientName) return 'Collaborator'
        const localClient = providerRef.current?.doc.clientID
        if (typeof localClient === 'number' && clientName === `yjs_client_${localClient}`) {
          return 'you'
        }

        const match = clientName.match(/^yjs_client_(\d+)$/)
        if (!match) return 'Collaborator'

        const clientId = Number(match[1])
        const awareness = providerRef.current?.awareness
        if (!awareness) return 'Collaborator'

        const state = awareness.getStates().get(clientId)
        const userState =
          state && typeof state === 'object' && !Array.isArray(state)
            ? (state as Record<string, unknown>).user
            : undefined
        return normalizePresenceUser(userState, clientId).name
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
        getQuoteTypingPreferences: () => quoteTypingPreferencesRef.current,
        getNotesMap: () => notesMapRef.current,
        collaboration: {
          yjsFragment: type,
          yjsMapping: mapping as ProsemirrorMapping,
        },
        aiWriterController: aiController,
        aiHandlers: {
          onAccept(zoneId) {
            if (viewRef.current) aiController.acceptAI(viewRef.current, zoneId)
          },
          onReject(zoneId) {
            if (viewRef.current) aiController.rejectAI(viewRef.current, zoneId)
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
        ...createMathNodeViews(),
        note_marker: createNoteMarkerNodeView(),
      },
      dispatchTransaction(tr) {
        const previousZones = aiWriterPluginKey.getState(view.state)?.zones ?? []
        const newState = view.state.apply(tr)
        view.updateState(newState)

        if (tr.docChanged) {
          const nextZones = aiWriterPluginKey.getState(newState)?.zones ?? []
          for (const sessionId of sessionIdsWithEndedZoneStreaming(previousZones, nextZones)) {
            bubblePresence.clear(sessionId)
          }
        }

        emitEditorViewChange(view)
        emitAIStateChange(view)

        const { from, to, empty } = newState.selection
        if (newState.selection instanceof NodeSelection) {
          const selectedNode = newState.selection.node
          if (selectedNode.type.name === 'math_inline' || selectedNode.type.name === 'math_block') {
            setActiveMath({
              pos: newState.selection.from,
              node: selectedNode,
              entryEdge: getMathEntryEdge(newState, newState.selection.from),
            })
          } else {
            setActiveMath(null)
          }
        } else {
          setActiveMath(null)
        }
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
        setNotesMap(provider.notes)
        notesMapRef.current = provider.notes
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

      view.dom.removeEventListener('focusin', handleViewFocusIn)
      view.dom.removeEventListener('focusout', handleViewFocusOut)
      document.removeEventListener('selectionchange', syncSelectionFromDOM)
      view.dom.removeEventListener('mouseup', syncSelectionFromDOM)
      view.destroy()
      viewRef.current = null

      if (providerRef.current) {
        providerRef.current.disconnect()
        providerRef.current = null
      }
      setPresenceAwareness(null)
      setNotesMap(null)
      notesMapRef.current = null
      setEditorView(null)
      setStoreEditorView(null)
      setStoreEditorSelection(null)
      setStoreSelectionRange(null)
      setStoreIsEditorFocused(false)
      setIsLoading(true)
      setStoreIsGenerating(false)
      useEditorStore.getState().setSessions(() => ({}))
      useEditorStore.getState().clearDismissedRestoreSuggestions()
      selectionToolbarInteractingRef.current = false
      inlineAIControlsInteractingRef.current = false
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

  const handleMobileBlockBarInteractionChange = useCallback((interacting: boolean) => {
    setMobileBlockBarInteracting(interacting)
  }, [])

  const handleInlineAIInteractionChange = useCallback((interacting: boolean) => {
    inlineAIControlsInteractingRef.current = interacting
  }, [])

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
        onConvertSelectionToMath={(selection) => {
          if (!viewRef.current) return false
          const view = viewRef.current
          if (view.state.selection.from !== selection.from || view.state.selection.to !== selection.to) {
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, selection.from, selection.to)))
          }
          return toggleInlineMath(view)
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
        onUndoTurn={(zoneId) => {
          if (!viewRef.current || !aiControllerRef.current || !zoneId) return
          const sessionId = getAIZones(viewRef.current).find(
            (zone) => zone.id === zoneId
          )?.sessionId
          if (!sessionId) return
          void aiControllerRef.current.undoSessionTurn(viewRef.current, sessionId)
        }}
        onRedoTurn={(zoneId) => {
          if (!viewRef.current || !aiControllerRef.current || !zoneId) return
          const sessionId = getAIZones(viewRef.current).find(
            (zone) => zone.id === zoneId
          )?.sessionId
          if (!sessionId) return
          void aiControllerRef.current.redoSessionTurn(viewRef.current, sessionId)
        }}
        onRestoreAcceptedSession={(sessionId) => {
          if (!viewRef.current || !aiControllerRef.current) return
          void aiControllerRef.current.restoreAcceptedSession(viewRef.current, sessionId)
        }}
        onInteractionChange={handleToolbarInteractionChange}
        onInlineAIInteractionChange={handleInlineAIInteractionChange}
        getCollaboratorDisplayName={(clientName) =>
          aiControllerRef.current?.getCollaboratorDisplayName(clientName) ?? 'Collaborator'
        }
        getLocalClientName={() => {
          const clientId = providerRef.current?.doc.clientID
          if (typeof clientId !== 'number') return null
          return `yjs_client_${clientId}`
        }}
        mobileBlockBarInteracting={mobileBlockBarInteracting}
        onBlockBarInteractionChange={handleMobileBlockBarInteractionChange}
        notesMap={notesMap}
        currentUserId={noteCreatorUserId}
        onNoteCreated={(noteId, anchorId) => setJustCreatedNote({ id: noteId, anchorId })}
      />
      <MathControls view={editorView} active={activeMath} />
      <RemotePresenceOverlay view={editorView} awareness={presenceAwareness} />
      <SearchResultMarkers
        view={editorView}
        container={editorShell}
        markers={searchResultMarkers}
      />
      <SideElementsProvider view={editorView} container={editorShell}>
        <BlockHandle
          view={editorView}
          container={editorShell}
          notesMap={notesMap}
          noteCreatorUserId={noteCreatorUserId}
          onNoteCreated={(noteId, anchorId) => setJustCreatedNote({ id: noteId, anchorId })}
        />
        <NotesGutter
          view={editorView}
          container={editorShell}
          notesMap={notesMap}
          projectId={projectId}
          currentUserId={noteCreatorUserId}
          justCreatedNote={justCreatedNote}
          onJustCreatedNoteHandled={() => setJustCreatedNote(null)}
        />
      </SideElementsProvider>
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
