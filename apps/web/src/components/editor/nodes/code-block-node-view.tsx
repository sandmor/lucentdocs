import { createRoot, type Root } from 'react-dom/client'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view'
import { getHighlightedHTMLAsync } from '../prosemirror/syntax-highlighter'

// Highlighting replaces the overlay HTML for the whole block. Keep it off the
// typing path; the editable code layer remains immediately responsive.
const HIGHLIGHT_DEBOUNCE_MS = 75
import { CodeBlockCopyButton, CodeBlockLanguageSelector } from './code-block-node-view-controls'

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (id: number) => void
}

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
  private header: HTMLElement
  private editorContainer: HTMLElement
  private preElement: HTMLElement
  private highlightPre: HTMLElement
  private highlightCode: HTMLElement
  private highlightFrame: number | null = null
  private highlightIdleCallback: number | null = null
  private highlightDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private highlightGeneration = 0
  private syncHighlightScroll = () => {
    this.highlightPre.style.transform = `translateX(-${this.preElement.scrollLeft}px)`
  }

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

    this.header = document.createElement('div')
    this.header.className = 'code-block-header'
    this.header.contentEditable = 'false'

    this.reactRootElement = document.createElement('div')
    this.header.appendChild(this.reactRootElement)
    this.reactRoot = createRoot(this.reactRootElement)

    this.copyRootElement = document.createElement('div')
    this.header.appendChild(this.copyRootElement)
    this.copyRoot = createRoot(this.copyRootElement)

    this.editorContainer = document.createElement('div')
    this.editorContainer.className = 'code-block-editor-container'
    this.editorContainer.setAttribute('spellcheck', 'false')

    this.preElement = document.createElement('pre')
    this.preElement.className = 'code-block-pre'
    this.preElement.setAttribute('data-language', node.attrs.language || '')
    this.preElement.setAttribute('spellcheck', 'false')
    this.preElement.setAttribute('autocorrect', 'off')
    this.preElement.setAttribute('autocapitalize', 'off')

    this.contentDOM = document.createElement('code')
    this.contentDOM.className = 'code-block-editable'
    this.contentDOM.spellcheck = false
    this.contentDOM.setAttribute('autocorrect', 'off')
    this.contentDOM.setAttribute('autocapitalize', 'off')

    this.preElement.appendChild(this.contentDOM)
    this.editorContainer.appendChild(this.preElement)

    this.highlightPre = document.createElement('pre')
    this.highlightPre.className = 'code-block-pre code-block-highlight-pre'
    this.highlightPre.setAttribute('aria-hidden', 'true')

    this.highlightCode = document.createElement('code')
    this.highlightCode.className = 'code-block-highlight'
    this.highlightPre.appendChild(this.highlightCode)
    this.editorContainer.appendChild(this.highlightPre)

    this.dom.appendChild(this.header)
    this.dom.appendChild(this.editorContainer)

    this.preElement.addEventListener('scroll', this.syncHighlightScroll)

    this.renderReact()
    this.updateHighlighting()
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

  private updateHighlighting() {
    const generation = ++this.highlightGeneration
    if (this.highlightDebounceTimer !== null) {
      clearTimeout(this.highlightDebounceTimer)
    }
    if (this.highlightIdleCallback !== null) {
      const idleWindow = window as IdleWindow
      if (idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(this.highlightIdleCallback)
      } else {
        clearTimeout(this.highlightIdleCallback)
      }
      this.highlightIdleCallback = null
    }

    this.highlightDebounceTimer = setTimeout(() => {
      this.highlightDebounceTimer = null
      if (this.highlightFrame !== null) {
        cancelAnimationFrame(this.highlightFrame)
      }

      this.highlightFrame = requestAnimationFrame(() => {
        this.highlightFrame = null
        const run = () => {
          this.highlightIdleCallback = null
          void this.runHighlighting(generation)
        }
        const idleWindow = window as IdleWindow
        this.highlightIdleCallback = idleWindow.requestIdleCallback
          ? idleWindow.requestIdleCallback(run, { timeout: 750 })
          : window.setTimeout(run, 0)
      })
    }, HIGHLIGHT_DEBOUNCE_MS)
  }

  private async runHighlighting(generation: number) {
    const language = this.node.attrs.language || ''
    const content = this.node.textContent
    const html = await getHighlightedHTMLAsync(content, language)

    if (generation !== this.highlightGeneration) return

    this.highlightCode.innerHTML = html
    this.syncHighlightScroll()
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false

    const prevLanguage = this.node.attrs.language
    const prevContent = this.node.textContent
    this.node = node

    if (prevLanguage !== node.attrs.language) {
      this.renderReact()
    }
    this.preElement.setAttribute('data-language', node.attrs.language || '')

    if (prevContent !== node.textContent || prevLanguage !== node.attrs.language) {
      this.updateHighlighting()
    }

    return true
  }

  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === 'selection') return false

    const target = mutation.target as Node
    if (this.header.contains(target)) return true
    if (this.highlightPre.contains(target)) return true

    if (this.contentDOM.contains(target) || target === this.contentDOM) {
      return false
    }

    return true
  }

  stopEvent(event: Event): boolean {
    return (event.target as HTMLElement).closest('.code-block-header') !== null
  }

  destroy() {
    this.preElement.removeEventListener('scroll', this.syncHighlightScroll)
    if (this.highlightDebounceTimer !== null) {
      clearTimeout(this.highlightDebounceTimer)
      this.highlightDebounceTimer = null
    }
    if (this.highlightFrame !== null) {
      cancelAnimationFrame(this.highlightFrame)
      this.highlightFrame = null
    }
    if (this.highlightIdleCallback !== null) {
      const idleWindow = window as IdleWindow
      if (idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(this.highlightIdleCallback)
      } else {
        clearTimeout(this.highlightIdleCallback)
      }
      this.highlightIdleCallback = null
    }
    this.highlightGeneration++
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
