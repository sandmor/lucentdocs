import { useRef, useEffect, forwardRef, useImperativeHandle, useState, useCallback } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { initProseMirrorDoc } from 'y-prosemirror'
import { toast } from 'sonner'
import { schema } from '@plotline/shared'
import { buildPlugins, type ProsemirrorMapping } from './plugins'
import { createAIWriterController, type AIWriterController } from './ai-writer'
import { AIWriterFloatingControls } from './ai-writer-floating-controls'
import { emitAIStateChange } from './ai-writer-store'
import { createYjsProvider, type ConnectionStatus } from '@/lib/yjs-provider'

export interface EditorHandle {
  startAIContinuation: () => void
  startAIPrompt: (prompt: string) => void
}

interface EditorProps {
  documentId: string
  onConnectionChange?: (status: ConnectionStatus) => void
  onStreamingChange?: (streaming: boolean) => void
  includeAfterContext?: boolean
  className?: string
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { documentId, onConnectionChange, onStreamingChange, includeAfterContext, className },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onStreamingChangeRef = useRef(onStreamingChange)
  const includeAfterContextRef = useRef(includeAfterContext ?? false)
  const aiControllerRef = useRef<AIWriterController | null>(null)
  const providerRef = useRef<ReturnType<typeof createYjsProvider> | null>(null)
  const hasShownOfflineToastRef = useRef(false)

  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    onStreamingChangeRef.current = onStreamingChange
  }, [onStreamingChange])

  useEffect(() => {
    includeAfterContextRef.current = includeAfterContext ?? false
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
        onStreamingChangeRef.current?.(streaming)
      },
      getIncludeAfterContext() {
        return includeAfterContextRef.current
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

    const provider = createYjsProvider(documentId, handleConnectionChange, () => {
      if (destroyed) return
      setIsLoading(false)
    })
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
          onCancelAI(view) {
            aiController.cancelAI(view)
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
      },
    })

    viewRef.current = view
    setEditorView(view)

    const loadingTimeout = setTimeout(() => {
      if (!provider.isSynced()) {
        setIsLoading(false)
      }
    }, 3000)

    return () => {
      destroyed = true
      clearTimeout(loadingTimeout)

      aiController.cancelAI()
      aiControllerRef.current = null

      if (providerRef.current) {
        providerRef.current.disconnect()
        providerRef.current = null
      }

      view.destroy()
      viewRef.current = null
      setEditorView(null)
      setIsLoading(true)
    }
  }, [documentId, showOfflineToast, dismissOfflineToast, onConnectionChange])

  useImperativeHandle(ref, () => ({
    startAIContinuation() {
      if (!viewRef.current) return
      aiControllerRef.current?.startAIContinuation(viewRef.current)
    },
    startAIPrompt(prompt: string) {
      if (!viewRef.current) return
      aiControllerRef.current?.startAIPrompt(viewRef.current, prompt)
    },
  }))

  return (
    <div className="relative">
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
      <AIWriterFloatingControls
        view={editorView}
        onAccept={(zoneId) => {
          if (viewRef.current) aiControllerRef.current?.acceptAI(viewRef.current, zoneId)
        }}
        onReject={(zoneId) => {
          if (viewRef.current) aiControllerRef.current?.rejectAI(viewRef.current, zoneId)
        }}
      />
    </div>
  )
})
