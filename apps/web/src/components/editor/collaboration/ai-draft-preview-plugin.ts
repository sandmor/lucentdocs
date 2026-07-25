import { hasStreamingAIZone, replaceAIZoneTextInDoc } from '@lucentdocs/shared'
import { DOMSerializer, type Node as ProseMirrorNode } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { AIBubblePresenceStore, type AIBubblePresenceFrame } from './ai-bubble-presence'
import { emitAIZoneControlLayoutChange } from '../inline/layout-events'

export const aiDraftPreviewPluginKey = new PluginKey<AIDraftPreviewState>('ai_draft_preview')

export interface AIDraftPreviewRange {
  key: string
  sourceFrom: number
  sourceTo: number
  previewDoc: ProseMirrorNode
  zoneIds: readonly string[]
}

interface AIDraftPreviewState {
  frames: readonly AIBubblePresenceFrame[]
  ranges: readonly AIDraftPreviewRange[]
  decorations: DecorationSet
}

interface PreviewCandidate {
  frame: AIBubblePresenceFrame
  range: AIDraftPreviewRange
}

function childOffsets(doc: ProseMirrorNode): number[] {
  const offsets: number[] = []
  let offset = 0
  doc.forEach((node) => {
    offsets.push(offset)
    offset += node.nodeSize
  })
  offsets.push(offset)
  return offsets
}

function resolveChangedRange(
  doc: ProseMirrorNode,
  preview: ProseMirrorNode,
  key: string,
  zoneIds: readonly string[]
): AIDraftPreviewRange | null {
  let prefix = 0
  while (
    prefix < doc.childCount &&
    prefix < preview.childCount &&
    doc.child(prefix).eq(preview.child(prefix))
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < doc.childCount - prefix &&
    suffix < preview.childCount - prefix &&
    doc.child(doc.childCount - suffix - 1).eq(preview.child(preview.childCount - suffix - 1))
  ) {
    suffix += 1
  }

  const sourceOffsets = childOffsets(doc)
  const previewNodes: ProseMirrorNode[] = []
  for (let index = prefix; index < preview.childCount - suffix; index += 1) {
    previewNodes.push(preview.child(index))
  }
  if (previewNodes.length === 0) return null

  return {
    key,
    sourceFrom: sourceOffsets[prefix] ?? 0,
    sourceTo: sourceOffsets[doc.childCount - suffix] ?? doc.content.size,
    previewDoc: doc.type.create(null, previewNodes),
    zoneIds,
  }
}

function resolvePreviewRange(
  doc: ProseMirrorNode,
  frame: AIBubblePresenceFrame
): AIDraftPreviewRange | null {
  if (!frame.text.trim() || !hasStreamingAIZone(doc, frame.sessionId)) return null

  const replacement = replaceAIZoneTextInDoc(doc, frame.sessionId, frame.text, true)
  if (!replacement.changed || !replacement.zoneFound) return null

  return resolveChangedRange(doc, replacement.nextDoc, frame.sessionId, [frame.zoneId])
}

function rangesOverlap(left: AIDraftPreviewRange, right: AIDraftPreviewRange): boolean {
  return left.sourceFrom < right.sourceTo && right.sourceFrom < left.sourceTo
}

function composePreviewRange(
  doc: ProseMirrorNode,
  candidates: readonly PreviewCandidate[]
): AIDraftPreviewRange | null {
  const ordered = [...candidates].sort(
    (left, right) =>
      right.range.sourceFrom - left.range.sourceFrom ||
      left.frame.sessionId.localeCompare(right.frame.sessionId)
  )
  let preview = doc
  for (const candidate of ordered) {
    const replacement = replaceAIZoneTextInDoc(
      preview,
      candidate.frame.sessionId,
      candidate.frame.text,
      true
    )
    if (!replacement.zoneFound) return null
    preview = replacement.nextDoc
  }

  const frames = [...candidates].sort((left, right) =>
    left.frame.sessionId.localeCompare(right.frame.sessionId)
  )
  return resolveChangedRange(
    doc,
    preview,
    frames.map(({ frame }) => frame.sessionId).join('|'),
    frames.map(({ frame }) => frame.zoneId)
  )
}

/**
 * Plans local-only preview fragments for every active continuation draft.
 * Ranges that touch the same source blocks are composed before rendering so a
 * single paragraph is never hidden and replaced by competing widgets.
 */
export function resolveAIDraftPreviewRanges(
  doc: ProseMirrorNode,
  frames: readonly AIBubblePresenceFrame[]
): readonly AIDraftPreviewRange[] {
  const candidates = frames
    .map((frame) => {
      const range = resolvePreviewRange(doc, frame)
      return range ? { frame, range } : null
    })
    .filter((candidate): candidate is PreviewCandidate => candidate !== null)
    .sort(
      (left, right) =>
        left.range.sourceFrom - right.range.sourceFrom ||
        left.frame.sessionId.localeCompare(right.frame.sessionId)
    )

  const groups: PreviewCandidate[][] = []
  for (const candidate of candidates) {
    const previous = groups.at(-1)
    const groupEnd = previous
      ? Math.max(...previous.map(({ range }) => range.sourceTo))
      : Number.NEGATIVE_INFINITY
    if (
      previous &&
      candidate.range.sourceFrom < groupEnd &&
      previous.some(({ range }) => rangesOverlap(range, candidate.range))
    ) {
      previous.push(candidate)
    } else {
      groups.push([candidate])
    }
  }

  return groups
    .map((group) => composePreviewRange(doc, group))
    .filter((range): range is AIDraftPreviewRange => range !== null)
    .sort((left, right) => left.sourceFrom - right.sourceFrom)
}

function findActiveFrames(
  doc: ProseMirrorNode,
  presence: AIBubblePresenceStore
): readonly AIBubblePresenceFrame[] {
  const frames = new Map<string, AIBubblePresenceFrame>()
  const zoneType = doc.type.schema.nodes.ai_zone
  if (!zoneType) return []

  doc.descendants((node) => {
    if (node.type !== zoneType || node.attrs.streaming !== true) return true
    const zoneId = typeof node.attrs.id === 'string' ? node.attrs.id : ''
    const sessionId = typeof node.attrs.sessionId === 'string' ? node.attrs.sessionId : null
    if (!zoneId || !sessionId || frames.has(sessionId)) return false
    const frame = presence.getFrame(zoneId, sessionId)
    if (frame?.text.trim()) frames.set(sessionId, frame)
    return false
  })

  return [...frames.values()].sort((left, right) => left.sessionId.localeCompare(right.sessionId))
}

class AIDraftPreviewController {
  readonly dom: HTMLDivElement

  constructor(key: string) {
    this.dom = document.createElement('div')
    this.dom.className = 'ai-zone-draft-preview'
    this.dom.dataset.aiZonePreview = 'true'
    this.dom.dataset.aiZonePreviewKey = key
    this.dom.setAttribute('aria-label', 'AI draft preview')
  }

  render(range: AIDraftPreviewRange): HTMLDivElement {
    const serializer = DOMSerializer.fromSchema(range.previewDoc.type.schema)
    this.dom.replaceChildren(serializer.serializeFragment(range.previewDoc.content))
    emitAIZoneControlLayoutChange()
    return this.dom
  }

  destroy(): void {
    this.dom.remove()
  }
}

class AIDraftPreviewRegistry {
  #controllers = new Map<string, AIDraftPreviewController>()
  #root: HTMLElement | null = null
  #sourceObserver: MutationObserver | null = null

  bind(root: HTMLElement): void {
    this.#root = root
    this.#sourceObserver = new MutationObserver(() => this.hideSourceZoneSemantics())
    this.#sourceObserver.observe(root, { childList: true, subtree: true })
    this.hideSourceZoneSemantics()
  }

  render(range: AIDraftPreviewRange): HTMLDivElement {
    let controller = this.#controllers.get(range.key)
    if (!controller) {
      controller = new AIDraftPreviewController(range.key)
      this.#controllers.set(range.key, controller)
    }
    return controller.render(range)
  }

  renderAll(ranges: readonly AIDraftPreviewRange[]): void {
    const activeKeys = new Set(ranges.map((range) => range.key))
    for (const range of ranges) this.render(range)
    for (const [key, controller] of this.#controllers) {
      if (activeKeys.has(key)) continue
      controller.destroy()
      this.#controllers.delete(key)
    }
    this.hideSourceZoneSemantics()
  }

  /** Keeps the non-interactive source copy out of live-zone queries. */
  private hideSourceZoneSemantics(): void {
    if (!this.#root) return
    for (const zone of this.#root.querySelectorAll<HTMLElement>(
      '.ai-zone-preview-source-hidden .ai-generating-text'
    )) {
      zone.classList.remove('ai-generating-text')
      zone.classList.add('ai-zone-preview-source-zone')
      delete zone.dataset.aiZoneControlActive
    }
  }

  destroy(): void {
    this.#sourceObserver?.disconnect()
    this.#sourceObserver = null
    this.#root = null
    for (const controller of this.#controllers.values()) controller.destroy()
    this.#controllers.clear()
  }
}

function buildDecorations(
  doc: ProseMirrorNode,
  ranges: readonly AIDraftPreviewRange[],
  registry: AIDraftPreviewRegistry
): DecorationSet {
  const decorations: Decoration[] = []
  for (const range of ranges) {
    if (range.sourceFrom >= range.sourceTo) continue
    decorations.push(
      Decoration.widget(range.sourceFrom, () => registry.render(range), {
        key: `ai-zone-draft-preview:${range.key}`,
        side: -1,
      })
    )
    doc.forEach((node, offset) => {
      const to = offset + node.nodeSize
      if (offset < range.sourceFrom || to > range.sourceTo) return
      decorations.push(
        Decoration.node(offset, to, {
          class: 'ai-zone-preview-source-hidden',
          'aria-hidden': 'true',
        })
      )
    })
  }
  return decorations.length > 0 ? DecorationSet.create(doc, decorations) : DecorationSet.empty
}

/** Renders awareness-only continuation drafts with real editor block DOM. */
export function createAIDraftPreviewPlugin(
  presence: AIBubblePresenceStore
): Plugin<AIDraftPreviewState> {
  const registry = new AIDraftPreviewRegistry()

  return new Plugin<AIDraftPreviewState>({
    key: aiDraftPreviewPluginKey,
    state: {
      init: () => ({ frames: [], ranges: [], decorations: DecorationSet.empty }),
      apply(tr, previous, _oldState, state) {
        const frames = tr.getMeta(aiDraftPreviewPluginKey) as
          | readonly AIBubblePresenceFrame[]
          | undefined
        const nextFrames = frames ?? previous.frames
        const ranges = resolveAIDraftPreviewRanges(state.doc, nextFrames)
        return {
          frames: nextFrames,
          ranges,
          decorations: buildDecorations(state.doc, ranges, registry),
        }
      },
    },
    props: {
      decorations(state) {
        return aiDraftPreviewPluginKey.getState(state)?.decorations ?? DecorationSet.empty
      },
    },
    view(view) {
      let destroyed = false
      registry.bind(view.dom)
      const refresh = () => {
        if (destroyed) return
        view.dispatch(
          view.state.tr.setMeta(aiDraftPreviewPluginKey, findActiveFrames(view.state.doc, presence))
        )
        registry.renderAll(aiDraftPreviewPluginKey.getState(view.state)?.ranges ?? [])
      }
      // Awareness can fire while the outer EditorView constructor is running.
      // Deferring the transaction avoids dispatching before its host is initialized.
      const scheduleRefresh = () => queueMicrotask(refresh)
      const unsubscribe = presence.subscribe(scheduleRefresh)
      scheduleRefresh()

      return {
        update(updatedView) {
          registry.renderAll(aiDraftPreviewPluginKey.getState(updatedView.state)?.ranges ?? [])
        },
        destroy() {
          destroyed = true
          unsubscribe()
          registry.destroy()
        },
      }
    },
  })
}
