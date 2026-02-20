import { computePosition, autoUpdate, flip, shift, offset } from '@floating-ui/dom'
import type { EditorView } from 'prosemirror-view'
import { aiWriterPluginKey } from './ai-writer-plugin'
import type { AIWriterActionHandlers } from './ai-writer-plugin'

interface VirtualElement {
  getBoundingClientRect(): DOMRect
}

function createFloatingControlsDOM(handlers: AIWriterActionHandlers): HTMLDivElement {
  const container = document.createElement('div')
  container.className =
    'ai-writer-floating-controls fixed z-[60] inline-flex items-center gap-1.5 p-1 border border-border rounded-md bg-background shadow-sm'

  const acceptBtn = document.createElement('button')
  acceptBtn.className =
    'inline-flex items-center justify-center h-6 px-2 rounded border border-border bg-transparent text-muted-foreground text-xs font-medium transition-all cursor-pointer hover:bg-success hover:border-success hover:text-success-foreground'
  acceptBtn.title = 'Accept (Tab)'
  acceptBtn.setAttribute('data-action', 'accept')
  acceptBtn.setAttribute('type', 'button')
  acceptBtn.textContent = 'Accept'
  acceptBtn.onpointerdown = (event) => {
    event.preventDefault()
  }
  acceptBtn.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    handlers.onAccept()
  }

  const rejectBtn = document.createElement('button')
  rejectBtn.className =
    'inline-flex items-center justify-center h-6 px-2 rounded border border-border bg-transparent text-muted-foreground text-xs font-medium transition-all cursor-pointer hover:bg-destructive hover:border-destructive hover:text-destructive-foreground'
  rejectBtn.title = 'Reject (Escape)'
  rejectBtn.setAttribute('data-action', 'reject')
  rejectBtn.setAttribute('type', 'button')
  rejectBtn.textContent = 'Reject'
  rejectBtn.onpointerdown = (event) => {
    event.preventDefault()
  }
  rejectBtn.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    handlers.onReject()
  }

  container.appendChild(acceptBtn)
  container.appendChild(rejectBtn)
  return container
}

export class FloatingControls {
  private readonly root: HTMLDivElement
  private readonly handlers: AIWriterActionHandlers
  private cleanup: (() => void) | null = null

  constructor(handlers: AIWriterActionHandlers) {
    this.handlers = handlers
    this.root = createFloatingControlsDOM(this.handlers)
    document.body.appendChild(this.root)
    this.hide()
  }

  update(view: EditorView): void {
    const state = aiWriterPluginKey.getState(view.state)
    if (!state?.active || state.from === null || state.to === null || state.from >= state.to) {
      this.hide()
      return
    }

    const zoneTo = state.to

    const virtualEl: VirtualElement = {
      getBoundingClientRect: () => {
        const coords = view.coordsAtPos(zoneTo)
        return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top)
      },
    }

    this.root.style.display = 'inline-flex'

    this.cleanup?.()
    this.cleanup = autoUpdate(virtualEl, this.root, () => {
      computePosition(virtualEl, this.root, {
        placement: 'bottom-start',
        middleware: [offset(6), flip({ fallbackAxisSideDirection: 'end' }), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        Object.assign(this.root.style, {
          left: `${Math.round(x)}px`,
          top: `${Math.round(y)}px`,
        })
      })
    })
  }

  hide(): void {
    this.cleanup?.()
    this.cleanup = null
    this.root.style.display = 'none'
  }

  destroy(): void {
    this.cleanup?.()
    this.root.remove()
  }
}
