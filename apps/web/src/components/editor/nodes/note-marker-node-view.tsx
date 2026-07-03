import { MessageSquareText } from 'lucide-react'
import { createRoot, type Root } from 'react-dom/client'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view'

export class NoteMarkerNodeView implements NodeView {
  dom: HTMLElement
  private readonly node: PMNode
  private iconRoot: Root | null = null

  constructor(node: PMNode, _view: EditorView, _getPos: () => number | undefined) {
    this.node = node
    this.dom = document.createElement('div')
    this.dom.className = 'note-marker'
    this.dom.setAttribute('data-note-marker', 'true')
    this.dom.contentEditable = 'false'

    const iconHost = document.createElement('span')
    iconHost.className = 'note-marker__icon'
    this.dom.appendChild(iconHost)

    this.iconRoot = createRoot(iconHost)
    this.iconRoot.render(<MessageSquareText className="size-3.5" aria-hidden />)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    return true
  }

  ignoreMutation(record: ViewMutationRecord): boolean {
    if (!(record.target instanceof HTMLElement)) return false
    return this.dom.contains(record.target)
  }

  selectNode(): void {
    this.dom.classList.add('note-marker--selected')
  }

  deselectNode(): void {
    this.dom.classList.remove('note-marker--selected')
  }

  destroy(): void {
    this.iconRoot?.unmount()
    this.iconRoot = null
  }
}

export function createNoteMarkerNodeView() {
  return (
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined
  ): NoteMarkerNodeView => new NoteMarkerNodeView(node, view, getPos)
}
