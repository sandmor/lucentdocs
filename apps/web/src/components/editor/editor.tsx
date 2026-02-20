import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { Node as ProseMirrorNode } from 'prosemirror-model'
import { schema } from './schema'
import { buildPlugins } from './plugins'

export interface EditorHandle {
  /** Get the current document as JSON */
  getJSON: () => Record<string, unknown>
  /** Get the current document as plain text */
  getText: () => string
  /** Replace the entire document with new JSON content */
  setContent: (json: Record<string, unknown>) => void
  /** Insert text at the current cursor position */
  insertText: (text: string) => void
  /** Get the ProseMirror view instance */
  getView: () => EditorView | null
}

interface EditorProps {
  /** Initial document JSON (ProseMirror format) */
  initialContent?: Record<string, unknown>
  /** Called whenever the document changes */
  onChange?: (json: Record<string, unknown>) => void
  className?: string
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { initialContent, onChange, className },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Build initial state
  const createState = useCallback((content?: Record<string, unknown>) => {
    const doc = content
      ? ProseMirrorNode.fromJSON(schema, content)
      : schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph' }] })

    return EditorState.create({
      doc,
      plugins: buildPlugins(),
    })
  }, [])

  // Mount editor
  useEffect(() => {
    if (!containerRef.current) return

    const state = createState(initialContent)
    const view = new EditorView(containerRef.current, {
      state,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr)
        view.updateState(newState)

        if (tr.docChanged) {
          onChangeRef.current?.(newState.doc.toJSON() as Record<string, unknown>)
        }
      },
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Expose handle to parent
  useImperativeHandle(ref, () => ({
    getJSON() {
      if (!viewRef.current) return { type: 'doc', content: [] }
      return viewRef.current.state.doc.toJSON() as Record<string, unknown>
    },
    getText() {
      if (!viewRef.current) return ''
      return viewRef.current.state.doc.textContent
    },
    setContent(json: Record<string, unknown>) {
      if (!viewRef.current) return
      const doc = ProseMirrorNode.fromJSON(schema, json)
      const state = EditorState.create({
        doc,
        plugins: viewRef.current.state.plugins,
      })
      viewRef.current.updateState(state)
    },
    insertText(text: string) {
      const view = viewRef.current
      if (!view) return
      const { state } = view
      const { from } = state.selection
      const tr = state.tr.insertText(text, from)
      view.dispatch(tr)
    },
    getView() {
      return viewRef.current
    },
  }))

  return <div ref={containerRef} className={className} />
})
