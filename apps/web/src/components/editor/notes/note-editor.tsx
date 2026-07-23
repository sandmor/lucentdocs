import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { EditorState, NodeSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { initProseMirrorDoc, ySyncPlugin } from 'y-prosemirror'
import type * as Y from 'yjs'
import { noteSchema } from '@lucentdocs/shared'
import { baseKeymap } from 'prosemirror-commands'
import { keymap } from 'prosemirror-keymap'
import { history } from 'prosemirror-history'
import { createMathNodeViews } from '../nodes/math-node-view'
import { MathControls } from '../nodes/math-controls'
import { createMathNavigationPlugin, getMathEntryEdge } from '../prosemirror/math-navigation-plugin'
import { createMarkdownClipboardPlugin } from '../prosemirror/list-commands'

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
    const [activeMath, setActiveMath] = useState<{
      view: EditorView
      pos: number
      node: import('prosemirror-model').Node
      entryEdge: 'start' | 'end'
    } | null>(null)

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
        plugins: [
          ySyncPlugin(body, { mapping }),
          history(),
          createMarkdownClipboardPlugin({ target: 'note' }),
          createMathNavigationPlugin(),
          keymap(baseKeymap),
        ],
      })

      const view = new EditorView(container, {
        state,
        nodeViews: createMathNodeViews(),
        editable: () => editableRef.current,
        dispatchTransaction(tr) {
          const next = view.state.apply(tr)
          view.updateState(next)
          if (next.selection instanceof NodeSelection && next.selection.node.type.name === 'math_inline') {
            setActiveMath({
              view,
              pos: next.selection.from,
              node: next.selection.node,
              entryEdge: getMathEntryEdge(next, next.selection.from),
            })
          } else {
            setActiveMath(null)
          }
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
        setActiveMath(null)
      }
    }, [body])

    useEffect(() => {
      const view = viewRef.current
      if (!view) return
      view.setProps({ editable: () => editable })
    }, [editable])

    return (
      <>
        <div ref={containerRef} className={className} />
        <MathControls view={activeMath?.view ?? null} active={activeMath} context="note" />
      </>
    )
  }
)
