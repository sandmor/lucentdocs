import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Sigma, TextCursorInput, Trash2 } from 'lucide-react'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { useIsCoarsePointer } from '../inline/hooks'
import { toggleInlineMath } from '../prosemirror/inline-math-commands'

interface ActiveMath {
  pos: number
  node: ProseMirrorNode
  entryEdge: 'start' | 'end'
}

export function MathControls({
  view,
  active,
  context = 'document',
}: {
  view: EditorView | null
  active: ActiveMath | null
  context?: 'document' | 'note'
}) {
  const isCoarsePointer = useIsCoarsePointer()
  const [position, setPosition] = useState({ left: 16, top: 16 })
  const sourceInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const setSourceInput = (element: HTMLInputElement | HTMLTextAreaElement | null) => {
    sourceInputRef.current = element
  }
  const isBlock = active?.node.type.name === 'math_block'
  const activeEntryEdge = active?.entryEdge
  const activePos = active?.pos

  useEffect(() => {
    if (!view || !active || isCoarsePointer) return
    const update = () => {
      const dom = view.nodeDOM(active.pos)
      if (!(dom instanceof HTMLElement)) return
      const rect = dom.getBoundingClientRect()
      const editorRect = view.dom.getBoundingClientRect()
      const surfaceWidth = context === 'note' ? 240 : active.node.type.name === 'math_block' ? 320 : 280
      const minLeft = context === 'note' ? 12 : Math.max(12, editorRect.left + 14)
      const maxLeft =
        context === 'note'
          ? window.innerWidth - surfaceWidth - 12
          : Math.min(window.innerWidth - surfaceWidth - 12, editorRect.right - surfaceWidth - 14)
      const anchorLeft = active.node.type.name === 'math_block' ? rect.left : rect.left - 10
      const preferredTop = rect.bottom + 14
      const top = preferredTop + 132 > window.innerHeight ? Math.max(12, rect.top - 132) : preferredTop
      setPosition({
        left: Math.max(minLeft, Math.min(anchorLeft, maxLeft)),
        top,
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [active, context, isCoarsePointer, view])

  useEffect(() => {
    if (!activeEntryEdge || activePos === undefined) return
    const frame = requestAnimationFrame(() => {
      const input = sourceInputRef.current
      if (!input) return
      input.focus()
      const offset = activeEntryEdge === 'start' ? 0 : input.value.length
      input.setSelectionRange(offset, offset)
    })
    return () => cancelAnimationFrame(frame)
  }, [activeEntryEdge, activePos])

  if (!view || !active) return null

  const commit = (next: string) => {
    const current = view.state.doc.nodeAt(active.pos)
    if (!current || current.type !== active.node.type) return
    const tr = view.state.tr.setNodeMarkup(active.pos, undefined, {
      ...current.attrs,
      latex: isBlock ? next : next.replace(/[\r\n]+/g, ' ').trim(),
    })
    tr.setSelection(NodeSelection.create(tr.doc, active.pos))
    view.dispatch(tr)
  }
  const moveCaretOutOfMath = (side: 'before' | 'after' = 'after') => {
    const current = view.state.doc.nodeAt(active.pos)
    const currentSize = current?.nodeSize ?? active.node.nodeSize
    const isEmpty = !String(current?.attrs.latex ?? active.node.attrs.latex ?? '').trim()
    const tr = isEmpty
      ? view.state.tr.delete(active.pos, active.pos + currentSize)
      : view.state.tr
    const boundary = isEmpty
      ? active.pos
      : side === 'before'
        ? active.pos
        : active.pos + currentSize
    const $boundary = tr.doc.resolve(Math.max(0, Math.min(boundary, tr.doc.content.size)))
    const nextSelection = $boundary.parent.inlineContent
      ? TextSelection.create(tr.doc, $boundary.pos)
      : (TextSelection.findFrom($boundary, side === 'before' ? -1 : 1) ??
        TextSelection.findFrom($boundary, side === 'before' ? 1 : -1))
    if (!nextSelection) return
    tr.setSelection(nextSelection).scrollIntoView()
    view.dispatch(tr)
    view.focus()
  }
  const remove = () => {
    const current = view.state.doc.nodeAt(active.pos)
    if (!current) return
    view.dispatch(view.state.tr.delete(active.pos, active.pos + current.nodeSize))
    view.focus()
  }

  const handleSourceKeyDown = (event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const input = event.currentTarget
    if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) {
      if (isBlock && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        moveCaretOutOfMath('after')
      }
      return
    }

    const start = input.selectionStart ?? 0
    const end = input.selectionEnd ?? start
    const collapsed = start === end
    const length = input.value.length

    if (collapsed && event.key === 'ArrowLeft' && start === 0) {
      event.preventDefault()
      moveCaretOutOfMath('before')
      return
    }
    if (collapsed && event.key === 'ArrowRight' && end === length) {
      event.preventDefault()
      moveCaretOutOfMath('after')
      return
    }
    if (isBlock && collapsed && event.key === 'ArrowUp' && input.value.lastIndexOf('\n', start - 1) < 0) {
      event.preventDefault()
      moveCaretOutOfMath('before')
      return
    }
    if (isBlock && collapsed && event.key === 'ArrowDown' && input.value.indexOf('\n', end) < 0) {
      event.preventDefault()
      moveCaretOutOfMath('after')
      return
    }
    if (event.key === 'Escape' || (!isBlock && event.key === 'Enter')) {
      event.preventDefault()
      moveCaretOutOfMath('after')
    }
  }

  const body = (
    <div
      data-editor-floating-obstacle="true"
      className={`math-editor-surface math-editor-surface--${isBlock ? 'block' : 'inline'} math-editor-surface--${context} ${isCoarsePointer ? 'math-editor-surface--mobile' : ''}`}
      style={isCoarsePointer ? undefined : { left: position.left, top: position.top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="math-editor-surface__header">
        <span>
          <Sigma className="size-3" /> {isBlock ? 'Equation' : 'Inline equation'}
        </span>
        <div className="flex items-center gap-1">
          {!isBlock ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Turn equation into text"
              title="Turn into text"
              onClick={() => toggleInlineMath(view)}
            >
              <TextCursorInput className="size-3" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Delete equation"
            onClick={remove}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>
      <div className="math-editor-surface__canvas">
        {isBlock ? (
          <Textarea
            key={`${active.pos}:${active.entryEdge}`}
            ref={setSourceInput}
            autoFocus
            defaultValue={String(active.node.attrs.latex ?? '')}
            placeholder="\\frac{a}{b}"
            className="math-editor-surface__input font-mono text-xs"
            onChange={(event) => {
              const next = event.target.value
              commit(next)
            }}
            onKeyDown={handleSourceKeyDown}
          />
        ) : (
          <Input
            key={`${active.pos}:${active.entryEdge}`}
            ref={setSourceInput}
            autoFocus
            defaultValue={String(active.node.attrs.latex ?? '')}
            placeholder="x^2 + y^2"
            className="math-editor-surface__input font-mono text-xs"
            onChange={(event) => {
              const next = event.target.value
              commit(next)
            }}
            onKeyDown={handleSourceKeyDown}
          />
        )}
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
