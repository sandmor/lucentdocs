import { useRef, useEffect, forwardRef, useImperativeHandle, useState } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { Node as ProseMirrorNode } from 'prosemirror-model'
import { schema } from './schema'
import { buildPlugins } from './plugins'
import { getAIDraftRange, aiWriterPluginKey, type AIWriterDraftRange } from './ai-writer-plugin'
import { createAIWriterController, type AIWriterController } from './ai-writer'
import { AIWriterFloatingControls } from './ai-writer-floating-controls'
import { emitAIStateChange } from './ai-writer-store'

export interface EditorHandle {
  /** Replace the entire document with new JSON content */
  setContent: (json: Record<string, unknown>) => void
  /** Get the ProseMirror view instance */
  getView: () => EditorView | null
  /** Start AI continuation at current cursor position */
  startAIContinuation: () => void
  /** Start AI generation with custom prompt */
  startAIPrompt: (prompt: string) => void
  /** Accept the current AI generation */
  acceptAI: () => void
  /** Reject the current AI generation */
  rejectAI: () => void
  /** Check if AI generation is active */
  isAIActive: () => boolean
  /** Get full persisted content (document + AI draft) */
  getPersistedContent: () => {
    doc: Record<string, unknown>
    aiDraft: AIWriterDraftRange | null
  }
}

interface EditorProps {
  /** Initial document JSON (ProseMirror format) */
  initialContent?: Record<string, unknown>
  /** Called whenever the document changes */
  onChange?: (json: Record<string, unknown>) => void
  /** Called when AI streaming starts/stops (zone may still be active) */
  onStreamingChange?: (streaming: boolean) => void
  initialAIDraft?: AIWriterDraftRange | null
  /** Whether to include text after cursor for AI context */
  includeAfterContext?: boolean
  className?: string
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { initialContent, onChange, onStreamingChange, initialAIDraft, includeAfterContext, className },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onStreamingChangeRef = useRef(onStreamingChange)
  const includeAfterContextRef = useRef(includeAfterContext ?? false)
  const aiControllerRef = useRef<AIWriterController | null>(null)
  onChangeRef.current = onChange
  onStreamingChangeRef.current = onStreamingChange
  includeAfterContextRef.current = includeAfterContext ?? false
  const [editorView, setEditorView] = useState<EditorView | null>(null)

  // Mount editor
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

    const viewHolder = { current: null as EditorView | null }

    const createState = (content?: Record<string, unknown>, draft?: AIWriterDraftRange | null) => {
      let doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph' }] })

      if (content) {
        try {
          doc = ProseMirrorNode.fromJSON(schema, content)
        } catch {
          doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph' }] })
        }
      }

      return EditorState.create({
        doc,
        plugins: buildPlugins({
          aiDraft: draft ?? null,
          aiHandlers: {
            onAccept() {
              if (viewHolder.current) aiController.acceptAI(viewHolder.current)
            },
            onReject() {
              if (viewHolder.current) aiController.rejectAI(viewHolder.current)
            },
            onCancelAI(view) {
              aiController.cancelAI(view)
            },
          },
        }),
      })
    }

    const state = createState(initialContent, initialAIDraft)
    const view = new EditorView(containerRef.current, {
      state,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr)
        view.updateState(newState)

        const meta = tr.getMeta(aiWriterPluginKey)
        const isRevert = meta?.type === 'revert_for_accept'

        if (!isRevert && (tr.docChanged || Boolean(meta))) {
          onChangeRef.current?.(newState.doc.toJSON() as Record<string, unknown>)
        }

        emitAIStateChange(view)
      },
    })

    viewHolder.current = view
    viewRef.current = view
    setEditorView(view)

    return () => {
      aiController.cancelAI()
      aiControllerRef.current = null
      view.destroy()
      viewRef.current = null
      setEditorView(null)
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Expose handle to parent
  useImperativeHandle(ref, () => ({
    setContent(json: Record<string, unknown>) {
      if (!viewRef.current) return
      let doc
      try {
        doc = ProseMirrorNode.fromJSON(schema, json)
      } catch {
        doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph' }] })
      }

      const state = EditorState.create({
        doc,
        plugins: viewRef.current.state.plugins,
      })
      viewRef.current.updateState(state)
    },
    getView() {
      return viewRef.current
    },
    startAIContinuation() {
      if (!viewRef.current) return
      aiControllerRef.current?.startAIContinuation(viewRef.current)
    },
    startAIPrompt(prompt: string) {
      if (!viewRef.current) return
      aiControllerRef.current?.startAIPrompt(viewRef.current, prompt)
    },
    acceptAI() {
      if (!viewRef.current) return
      aiControllerRef.current?.acceptAI(viewRef.current)
    },
    rejectAI() {
      if (!viewRef.current) return
      aiControllerRef.current?.rejectAI(viewRef.current)
    },
    isAIActive() {
      if (!viewRef.current) return false
      return aiControllerRef.current?.isAIActive(viewRef.current) ?? false
    },
    getPersistedContent() {
      if (!viewRef.current) {
        return {
          doc: { type: 'doc', content: [] },
          aiDraft: null,
        }
      }

      return {
        doc: viewRef.current.state.doc.toJSON() as Record<string, unknown>,
        aiDraft: getAIDraftRange(viewRef.current),
      }
    },
  }))

  return (
    <>
      <div ref={containerRef} className={className} />
      <AIWriterFloatingControls
        view={editorView}
        onAccept={() => {
          if (viewRef.current) aiControllerRef.current?.acceptAI(viewRef.current)
        }}
        onReject={() => {
          if (viewRef.current) aiControllerRef.current?.rejectAI(viewRef.current)
        }}
      />
    </>
  )
})
