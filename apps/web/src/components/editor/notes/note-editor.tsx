import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { initProseMirrorDoc, ySyncPlugin } from 'y-prosemirror'
import type * as Y from 'yjs'
import { noteSchema } from '@lucentdocs/shared'
import { baseKeymap } from 'prosemirror-commands'
import { keymap } from 'prosemirror-keymap'
import { history } from 'prosemirror-history'

export interface NoteEditorHandle {
  focus(): void
}

interface NoteEditorProps {
  body: Y.XmlFragment
  yMap?: Y.Map<unknown>
  className?: string
  editable?: boolean
  onFocus?: () => void
  onBlur?: () => void
}

export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(
  function NoteEditor({ body, yMap, className, editable = true, onFocus, onBlur }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const viewRef = useRef<EditorView | null>(null)

    const editableRef = useRef(editable)
    const onFocusRef = useRef(onFocus)
    const onBlurRef = useRef(onBlur)
    const yMapRef = useRef(yMap)

    useEffect(() => {
      editableRef.current = editable
    }, [editable])
    useEffect(() => {
      onFocusRef.current = onFocus
    }, [onFocus])
    useEffect(() => {
      onBlurRef.current = onBlur
    }, [onBlur])
    useEffect(() => {
      yMapRef.current = yMap
    }, [yMap])

    useImperativeHandle(ref, () => ({
      focus() {
        viewRef.current?.focus()
      },
    }))

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
        editable: () => editableRef.current,
        dispatchTransaction(tr) {
          const next = view.state.apply(tr)
          view.updateState(next)
          if (tr.docChanged && yMapRef.current) {
            yMapRef.current.set('updatedAt', Date.now())
          }
        },
        attributes: {
          class: 'note-editor-content outline-none text-sm leading-relaxed',
        },
        handleDOMEvents: {
          focus: () => {
            onFocusRef.current?.()
            return false
          },
          blur: () => {
            onBlurRef.current?.()
            return false
          },
        },
      })

      viewRef.current = view

      return () => {
        view.destroy()
        viewRef.current = null
      }
    }, [body])

    useEffect(() => {
      const view = viewRef.current
      if (!view) return
      view.setProps({ editable: () => editable })
    }, [editable])

    return <div ref={containerRef} className={className} />
  }
)
