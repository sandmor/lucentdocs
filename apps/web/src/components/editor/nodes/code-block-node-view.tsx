import { createRoot, type Root } from 'react-dom/client'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view'
import { CodeBlockCopyButton, CodeBlockLanguageSelector } from './code-block-node-view-controls'

export class CodeBlockNodeView implements NodeView {
  node: ProseMirrorNode
  view: EditorView
  getPos: boolean | (() => number | undefined)
  dom: HTMLElement
  contentDOM: HTMLElement
  reactRoot: Root | null = null
  reactRootElement: HTMLDivElement
  copyRoot: Root | null = null
  copyRootElement: HTMLDivElement

  constructor(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: boolean | (() => number | undefined)
  ) {
    this.node = node
    this.view = view
    this.getPos = getPos

    this.dom = document.createElement('div')
    this.dom.className = 'code-block-wrapper'

    const header = document.createElement('div')
    header.className = 'code-block-header'
    header.contentEditable = 'false'

    this.reactRootElement = document.createElement('div')
    header.appendChild(this.reactRootElement)
    this.reactRoot = createRoot(this.reactRootElement)

    this.copyRootElement = document.createElement('div')
    header.appendChild(this.copyRootElement)
    this.copyRoot = createRoot(this.copyRootElement)

    this.renderReact()

    const pre = document.createElement('pre')
    pre.setAttribute('data-language', node.attrs.language || '')

    this.contentDOM = document.createElement('code')
    this.contentDOM.spellcheck = false

    pre.appendChild(this.contentDOM)
    this.dom.appendChild(header)
    this.dom.appendChild(pre)
  }

  handleLanguageChange = (val: string) => {
    if (typeof this.getPos !== 'function') return
    const pos = this.getPos()
    if (typeof pos === 'number') {
      const tr = this.view.state.tr.setNodeMarkup(pos, null, {
        ...this.node.attrs,
        language: val,
      })
      this.view.dispatch(tr)
    }
  }

  renderReact() {
    if (this.reactRoot) {
      this.reactRoot.render(
        <CodeBlockLanguageSelector
          value={this.node.attrs.language || ''}
          onChange={this.handleLanguageChange}
        />
      )
    }

    if (this.copyRoot) {
      this.copyRoot.render(<CodeBlockCopyButton getText={() => this.node.textContent} />)
    }
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node

    this.renderReact()

    const pre = this.dom.querySelector('pre')
    if (pre) {
      pre.setAttribute('data-language', node.attrs.language || '')
    }

    return true
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === 'selection') return false
    return (mutation.target as HTMLElement).closest('.code-block-header') !== null
  }

  stopEvent(event: Event): boolean {
    return (event.target as HTMLElement).closest('.code-block-header') !== null
  }

  destroy() {
    if (this.reactRoot) {
      this.reactRoot.unmount()
      this.reactRoot = null
    }
    if (this.copyRoot) {
      this.copyRoot.unmount()
      this.copyRoot = null
    }
  }
}

export function createCodeBlockNodeView() {
  return {
    code_block(
      node: ProseMirrorNode,
      view: EditorView,
      getPos: boolean | (() => number | undefined)
    ) {
      return new CodeBlockNodeView(node, view, getPos)
    },
  }
}
