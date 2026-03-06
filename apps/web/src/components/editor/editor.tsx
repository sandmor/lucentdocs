import { useRef, useEffect, forwardRef, useImperativeHandle, useState, useCallback } from 'react'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { initProseMirrorDoc } from 'y-prosemirror'
import { toast } from 'sonner'
import { schema } from '@lucentdocs/shared'
import { buildPlugins, type ProsemirrorMapping } from './prosemirror/plugins'
import { createAIWriterController, type AIWriterController } from './ai/writer'
import { InlineAIControls } from './inline/controls'
import { useAIWriterState } from './inline/hooks'
import { SelectionFakeOverlay } from './selection/fake-overlay'
import type { SelectionRange } from './selection/types'
import { emitAIStateChange } from './ai/writer-store'
import { EditorToolbar } from './layout/toolbar'
import { hasActiveDomSelection } from './selection/dom-selection'
import { useInlineSessions } from './inline/use-sessions'
import { createYjsProvider, type ConnectionStatus } from '@/lib/yjs-provider'

export interface EditorHandle {
  startAIContinuation: (at_doc_end: boolean) => void
}

interface EditorProps {
  projectId?: string
  documentId: string
  onConnectionChange?: (status: ConnectionStatus) => void
  onEditorViewReady?: (view: EditorView | null) => void
  onEditorSelectionChange?: (selection: { from: number; to: number } | null) => void
  includeAfterContext?: boolean
  onIncludeAfterContextChange?: (value: boolean) => void
  className?: string
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  {
    projectId,
    documentId,
    onConnectionChange,
    onEditorViewReady,
    onEditorSelectionChange,
    includeAfterContext,
    onIncludeAfterContextChange,
    className,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const includeAfterContextRef = useRef(includeAfterContext ?? true)
  const selectionToolbarInteractingRef = useRef(false)
  const aiControllerRef = useRef<AIWriterController | null>(null)
  const providerRef = useRef<ReturnType<typeof createYjsProvider> | null>(null)
  const hasShownOfflineToastRef = useRef(false)

  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [selectionRange, setSelectionRange] = useState<SelectionRange | null>(null)
  const [isEditorFocused, setIsEditorFocused] = useState(false)
  const [providerSessionKey, setProviderSessionKey] = useState(0)
  const aiState = useAIWriterState(editorView)
  const { inlineSessionsById, inlineSessionsRef, setInlineSessionsById } = useInlineSessions({
    projectId,
    documentId,
    aiState,
  })

  useEffect(() => {
    includeAfterContextRef.current = includeAfterContext ?? true
  }, [includeAfterContext])

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

    const aiController = createAIWriterController({
      onStreamingChange(streaming) {
        setIsGenerating(streaming)
      },
      getIncludeAfterContext() {
        return includeAfterContextRef.current
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
        return inlineSessionsRef.current[sessionId] ?? null
      },
      setSessionById(sessionId, session) {
        setInlineSessionsById((previous) => {
          const current = previous[sessionId]
          if (session === null) {
            if (current === undefined) return previous
            const next = { ...previous }
            delete next[sessionId]
            inlineSessionsRef.current = next
            return next
          }

          if (current === session) return previous
          const next = {
            ...previous,
            [sessionId]: session,
          }
          inlineSessionsRef.current = next
          return next
        })
      },
    })
    aiControllerRef.current = aiController

    let destroyed = false

    const handleConnectionChange = (status: ConnectionStatus) => {
      if (destroyed) return
      onConnectionChange?.(status)

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

    const type = provider.type
    const { doc: pmDoc, mapping } = initProseMirrorDoc(type, schema)

    const state = EditorState.create({
      doc: pmDoc,
      plugins: buildPlugins({
        yjsFragment: type,
        yjsMapping: mapping as ProsemirrorMapping,
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

    const view = new EditorView(containerRef.current, {
      state,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr)
        view.updateState(newState)
        emitAIStateChange(view)
        onEditorSelectionChange?.({
          from: newState.selection.from,
          to: newState.selection.to,
        })

        const { from, to, empty } = newState.selection
        const viewIsFocused = view.hasFocus()
        const interacting = selectionToolbarInteractingRef.current

        setIsEditorFocused((previous) => (previous === viewIsFocused ? previous : viewIsFocused))
        setSelectionRange((previous) => {
          if (!empty) {
            if (!viewIsFocused && !interacting) {
              return null
            }

            if (previous && previous.from === from && previous.to === to) {
              return previous
            }
            return { from, to }
          }

          if (previous && !tr.docChanged) {
            return previous
          }

          if (interacting && previous) {
            if (!tr.docChanged) {
              return previous
            }

            const mappedFrom = tr.mapping.map(previous.from, 1)
            const mappedTo = tr.mapping.map(previous.to, -1)
            if (mappedFrom < mappedTo) {
              if (previous.from === mappedFrom && previous.to === mappedTo) {
                return previous
              }
              return { from: mappedFrom, to: mappedTo }
            }
          }

          return null
        })
      },
    })

    viewRef.current = view
    setEditorView(view)
    onEditorViewReady?.(view)
    onEditorSelectionChange?.({
      from: view.state.selection.from,
      to: view.state.selection.to,
    })
    setIsEditorFocused(view.hasFocus())

    const syncSelectionFromDOM = () => {
      if (destroyed) return

      const domSelection = window.getSelection()
      if (!domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) {
        if (view.hasFocus() && !selectionToolbarInteractingRef.current) {
          setSelectionRange(null)
        }
        return
      }

      const range = domSelection.getRangeAt(0)
      if (!view.dom.contains(range.commonAncestorContainer)) {
        if (view.hasFocus() && !selectionToolbarInteractingRef.current) {
          setSelectionRange(null)
        }
        return
      }

      try {
        const anchor = view.posAtDOM(range.startContainer, range.startOffset, 1)
        const head = view.posAtDOM(range.endContainer, range.endOffset, -1)
        const from = Math.min(anchor, head)
        const to = Math.max(anchor, head)

        if (from >= to) return

        setSelectionRange((previous) => {
          if (previous && previous.from === from && previous.to === to) {
            return previous
          }
          return { from, to }
        })
      } catch {
        // Ignore transient DOM ranges that cannot be mapped to ProseMirror positions.
      }
    }

    const handleViewFocusIn = () => {
      setIsEditorFocused(true)
    }
    const handleViewFocusOut = () => {
      setIsEditorFocused(false)
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
      setEditorView(null)
      onEditorViewReady?.(null)
      onEditorSelectionChange?.(null)
      setIsLoading(true)
      setIsGenerating(false)
      setSelectionRange(null)
      setIsEditorFocused(false)
      inlineSessionsRef.current = {}
      setInlineSessionsById({})
      selectionToolbarInteractingRef.current = false
    }
  }, [
    projectId,
    documentId,
    providerSessionKey,
    inlineSessionsRef,
    setInlineSessionsById,
    showOfflineToast,
    dismissOfflineToast,
    onConnectionChange,
    onEditorSelectionChange,
    onEditorViewReady,
  ])

  useImperativeHandle(ref, () => ({
    startAIContinuation(at_doc_end: boolean) {
      if (!viewRef.current) return
      aiControllerRef.current?.startAIContinuation(viewRef.current, at_doc_end)
    },
  }))

  const handleToolbarInteractionChange = useCallback((interacting: boolean) => {
    selectionToolbarInteractingRef.current = interacting
    if (interacting || !viewRef.current) return

    if (!hasActiveDomSelection(viewRef.current)) {
      setSelectionRange(null)
      return
    }

    const { from, to, empty } = viewRef.current.state.selection
    setSelectionRange(empty ? null : { from, to })
  }, [])

  return (
    <div className="relative">
      <EditorToolbar
        isGenerating={isGenerating}
        includeAfterContext={includeAfterContext ?? true}
        onToggleIncludeAfterContext={(value) => {
          includeAfterContextRef.current = value
          onIncludeAfterContextChange?.(value)
        }}
        onContinueWriting={() => {
          if (!viewRef.current) return
          aiControllerRef.current?.startAIContinuation(viewRef.current, true)
        }}
      />

      <div ref={containerRef} className={className} />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80">
          <div className="animate-pulse space-y-4 w-3/4">
            <div className="bg-muted h-4 w-3/4 rounded" />
            <div className="bg-muted h-4 w-1/2 rounded" />
            <div className="bg-muted h-4 w-5/6 rounded" />
          </div>
        </div>
      )}
      <InlineAIControls
        view={editorView}
        selection={selectionRange}
        onGenerate={(prompt, selection) => {
          if (!viewRef.current || !aiControllerRef.current) return false
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
        sessionsById={inlineSessionsById}
      />
      <SelectionFakeOverlay
        view={editorView}
        selection={selectionRange}
        visible={Boolean(editorView && selectionRange && !isEditorFocused)}
      />
    </div>
  )
})
