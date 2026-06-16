import { useEffect, useRef } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { initProseMirrorDoc, ySyncPlugin } from 'y-prosemirror'
import type * as Y from 'yjs'
import { noteSchema } from '@lucentdocs/shared'
import { baseKeymap } from 'prosemirror-commands'
import { keymap } from 'prosemirror-keymap'
import { history } from 'prosemirror-history'

interface NoteEditorProps {
  body: Y.XmlFragment
  className?: string
  autoFocus?: boolean
  onFocus?: () => void
  onBlur?: () => void
}

export function NoteEditor({ body, className, autoFocus, onFocus, onBlur }: NoteEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const { doc, mapping } = initProseMirrorDoc(body, noteSchema)
    const state = EditorState.create({
      doc,
      plugins: [ySyncPlugin(body, { mapping }), history(), keymap(baseKeymap)],
    })

    const view = new EditorView(container, {
      state,
      dispatchTransaction(tr) {
        const next = view.state.apply(tr)
        view.updateState(next)
      },
      attributes: {
        class: 'note-editor-content outline-none min-h-[4rem] text-sm leading-relaxed',
      },
      handleDOMEvents: {
        focus: () => {
          onFocus?.()
          return false
        },
        blur: () => {
          onBlur?.()
          return false
        },
      },
    })

    viewRef.current = view
    if (autoFocus) {
      view.focus()
    }

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [body, autoFocus, onBlur, onFocus])

  return <div ref={containerRef} className={className} />
}
