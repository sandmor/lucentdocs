import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { DOMSerializer } from 'prosemirror-model'
import type { EditorProps, EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view'
import { parseMarkdownishToFragment, wrapFragmentWithZoneNodes } from '@lucentdocs/shared'
import { AIBubblePresenceStore } from './ai-bubble-presence'
import { getAIZones } from '../ai/writer-plugin'

class AIZoneNodeView implements NodeView {
  node: ProseMirrorNode
  dom: HTMLSpanElement
  contentDOM: HTMLSpanElement
  #overlayDOM: HTMLSpanElement
  #presence: AIBubblePresenceStore
  #view: EditorView
  #getPos: boolean | (() => number | undefined)
  #unsubscribe: (() => void) | null = null

  constructor(
    node: ProseMirrorNode,
    presence: AIBubblePresenceStore,
    view: EditorView,
    getPos: boolean | (() => number | undefined)
  ) {
    this.node = node
    this.#presence = presence
    this.#view = view
    this.#getPos = getPos

    this.dom = document.createElement('span')
    this.dom.className = 'ai-generating-text'

    this.contentDOM = document.createElement('span')
    this.contentDOM.className = 'ai-generating-text__content'

    this.#overlayDOM = document.createElement('span')
    this.#overlayDOM.className = 'ai-generating-text__overlay'
    this.#overlayDOM.hidden = true

    this.dom.append(this.contentDOM, this.#overlayDOM)
    this.#unsubscribe = this.#presence.subscribe(() => {
      this.#render()
    })
    this.#render()
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.#render()
    return true
  }

  destroy(): void {
    this.#unsubscribe?.()
    this.#unsubscribe = null
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return this.#overlayDOM.contains(mutation.target)
  }

  #resolvePosition(): number | null {
    if (typeof this.#getPos !== 'function') return null

    try {
      const pos = this.#getPos()
      return typeof pos === 'number' ? pos : null
    } catch {
      return null
    }
  }

  #isPrimaryZoneSegment(attrs: { id: string; sessionId?: string | null }): boolean {
    const currentPos = this.#resolvePosition()
    if (currentPos === null) return true

    const zone = getAIZones(this.#view).find(
      (entry) => entry.id === attrs.id && (entry.sessionId ?? null) === (attrs.sessionId ?? null)
    )
    const firstPos = zone?.segments[0]?.nodeFrom ?? null
    return firstPos === null || firstPos === currentPos
  }

  #render(): void {
    const attrs = this.node.attrs as {
      id: string
      streaming?: boolean
      sessionId?: string | null
      originalSlice?: string | null
    }

    this.dom.dataset.aiZoneId = attrs.id
    this.dom.dataset.aiZoneStreaming = String(attrs.streaming === true)
    this.dom.dataset.aiZoneSessionId = attrs.sessionId ?? ''
    this.dom.dataset.aiZoneOriginalSlice = attrs.originalSlice ?? ''

    const activeFrame =
      attrs.streaming === true ? this.#presence.getFrame(attrs.id, attrs.sessionId ?? null) : null
    const zoneInDraftMode = Boolean(activeFrame && activeFrame.text.length > 0)
    const showOverlay = zoneInDraftMode && this.#isPrimaryZoneSegment(attrs)

    this.dom.dataset.aiZoneOverlayActive = String(showOverlay)
    if (zoneInDraftMode) {
      this.contentDOM.style.visibility = 'hidden'
      this.contentDOM.style.pointerEvents = 'none'
      this.contentDOM.style.userSelect = 'none'
      this.contentDOM.setAttribute('aria-hidden', 'true')
    } else {
      this.contentDOM.style.visibility = ''
      this.contentDOM.style.pointerEvents = ''
      this.contentDOM.style.userSelect = ''
      this.contentDOM.removeAttribute('aria-hidden')
    }
    this.#overlayDOM.hidden = !showOverlay

    this.#overlayDOM.innerHTML = ''
    if (showOverlay && activeFrame?.text) {
      const fragment = parseMarkdownishToFragment(activeFrame.text)
      const wrappedFragment = wrapFragmentWithZoneNodes(
        fragment,
        this.#view.state.schema.nodes.ai_zone,
        {
          id: attrs.id,
          streaming: true,
          sessionId: attrs.sessionId ?? null,
          originalSlice: attrs.originalSlice ?? null,
        },
        true
      )
      const serialized = DOMSerializer.fromSchema(this.#view.state.schema).serializeFragment(
        wrappedFragment
      )
      this.#overlayDOM.appendChild(serialized)
    }
  }
}

export function createAIBubbleNodeViews(
  presence: AIBubblePresenceStore
): NonNullable<EditorProps['nodeViews']> {
  return {
    ai_zone(node, view, getPos) {
      return new AIZoneNodeView(node, presence, view, getPos)
    },
  }
}
