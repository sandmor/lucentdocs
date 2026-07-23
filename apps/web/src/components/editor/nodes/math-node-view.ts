import katex from 'katex'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { EditorView, NodeView } from 'prosemirror-view'

const KATEX_OPTIONS = {
  throwOnError: false,
  trust: false,
  output: 'htmlAndMathml' as const,
  strict: 'ignore' as const,
  maxSize: 20,
  maxExpand: 1000,
}

function hasKatexError(latex: string, displayMode: boolean): boolean {
  try {
    katex.renderToString(latex, { ...KATEX_OPTIONS, displayMode, throwOnError: true })
    return false
  } catch {
    return true
  }
}

class MathNodeView implements NodeView {
  node: ProseMirrorNode
  dom: HTMLElement
  private readonly renderTarget: HTMLElement
  private readonly displayMode: boolean
  private readonly view: EditorView
  private resizeObserver: ResizeObserver | null = null
  private overflowFrame: number | null = null

  constructor(node: ProseMirrorNode, view: EditorView) {
    this.node = node
    this.view = view
    this.displayMode = node.type.name === 'math_block'
    this.dom = document.createElement(this.displayMode ? 'div' : 'span')
    this.dom.className = this.displayMode ? 'math-block' : 'math-inline'
    this.dom.setAttribute(this.displayMode ? 'data-math-block' : 'data-math-inline', 'true')
    this.dom.contentEditable = 'false'

    if (this.displayMode) {
      this.dom.tabIndex = 0
      this.dom.setAttribute('role', 'region')
      this.dom.setAttribute('aria-label', 'Display equation. Scroll horizontally when needed.')
    }

    this.renderTarget = document.createElement('span')
    this.renderTarget.className = this.displayMode ? 'math-block-render' : 'math-inline-render'
    this.dom.appendChild(this.renderTarget)
    this.render()

    if (!this.displayMode && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.scheduleOverflowMeasurement())
      this.resizeObserver.observe(this.dom)
      this.resizeObserver.observe(this.view.dom)
    }
  }

  private render() {
    const latex = String(this.node.attrs.latex ?? '')
    this.dom.setAttribute('data-latex', latex)
    this.dom.dataset.mathInvalid = String(hasKatexError(latex, this.displayMode))
    this.renderTarget.replaceChildren()

    if (!latex.trim()) {
      this.renderTarget.textContent = this.displayMode ? 'Type an equation…' : 'equation'
      this.dom.dataset.mathEmpty = 'true'
      delete this.dom.dataset.mathOverflow
      return
    }

    delete this.dom.dataset.mathEmpty
    katex.render(latex, this.renderTarget, { ...KATEX_OPTIONS, displayMode: this.displayMode })
    this.scheduleOverflowMeasurement()
  }

  /**
   * KaTeX can wrap at semantic operator boundaries. When a formula has no
   * viable breakpoint, preserve its source and turn only its rendering into a
   * small horizontal scroll surface instead of letting it widen the editor.
   */
  private scheduleOverflowMeasurement() {
    if (this.displayMode || !this.node.attrs.latex?.trim()) return
    if (this.overflowFrame !== null) cancelAnimationFrame(this.overflowFrame)
    this.overflowFrame = requestAnimationFrame(() => {
      this.overflowFrame = null
      const editorWidth = this.view.dom.getBoundingClientRect().width
      const mathWidth = this.renderTarget.getBoundingClientRect().width
      const hasWrapped = this.dom.getClientRects().length > 1
      const isFallback = this.dom.dataset.mathOverflow === 'true'
      const overflows = isFallback
        ? mathWidth > this.dom.clientWidth + 1
        : !hasWrapped && mathWidth > editorWidth + 1

      if (overflows) this.dom.dataset.mathOverflow = 'true'
      else delete this.dom.dataset.mathOverflow
    })
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false
    if (node.attrs.latex !== this.node.attrs.latex) {
      this.node = node
      this.render()
      return true
    }
    this.node = node
    return true
  }

  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  ignoreMutation() {
    return true
  }

  destroy() {
    this.resizeObserver?.disconnect()
    if (this.overflowFrame !== null) cancelAnimationFrame(this.overflowFrame)
  }

  stopEvent(event: Event) {
    // Keep wheel/touch scrolling inside an overflowing block equation while
    // letting click events select the ProseMirror atom.
    return event.type === 'wheel' || event.type.startsWith('touch')
  }
}

export function createMathNodeViews() {
  return {
    math_inline(node: ProseMirrorNode, view: EditorView) {
      return new MathNodeView(node, view)
    },
    math_block(node: ProseMirrorNode, view: EditorView) {
      return new MathNodeView(node, view)
    },
  }
}
