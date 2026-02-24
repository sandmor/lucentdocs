import { Slice, type MarkType } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { toast } from 'sonner'
import { aiWriterPluginKey, getAIZones, type AIMode, type AIZone } from './ai-writer-plugin'
import { StuckDetector } from './ai-writer-stuck-detector'
import { parseMarkdownishToSlice } from './markdownish'

type StreamingHandler = (streaming: boolean) => void
interface AIWriterControllerOptions {
  onStreamingChange?: StreamingHandler
  getIncludeAfterContext?: () => boolean
}

interface AIZoneMarkAttrs {
  id: string
  mode: AIMode
  streaming: boolean
  choices: string | null
  deletedSlice: string | null
}

interface ZoneMarkPatch {
  mode?: AIMode
  streaming?: boolean
  choices?: string[] | null
  deletedSlice?: string | null
}

export interface AIWriterController {
  startAIContinuation: (view: EditorView, at_doc_end: boolean) => void
  startAIPromptAtRange: (
    view: EditorView,
    prompt: string,
    selectionFrom: number,
    selectionTo: number
  ) => boolean
  acceptAI: (view: EditorView, zoneId?: string) => void
  rejectAI: (view: EditorView, zoneId?: string) => void
  cancelAI: (view?: EditorView) => void
}

function createZoneId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `zone-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function getAIZoneMarkType(view: EditorView): MarkType | null {
  return view.state.schema.marks.ai_zone ?? null
}

function serializeChoices(choices: string[] | null | undefined): string | null {
  if (!choices || choices.length === 0) return null
  return JSON.stringify(choices)
}

function createZoneMarkAttrs(
  zoneId: string,
  mode: AIMode,
  streaming: boolean,
  choices: string[] | null,
  deletedSlice: string | null
): AIZoneMarkAttrs {
  return {
    id: zoneId,
    mode,
    streaming,
    choices: serializeChoices(choices),
    deletedSlice,
  }
}

function deserializeDeletedSlice(view: EditorView, value: string | null): Slice | null {
  if (!value) return null

  try {
    return Slice.fromJSON(view.state.schema, JSON.parse(value))
  } catch {
    return null
  }
}

function getTargetZone(view: EditorView, preferredZoneId?: string): AIZone | null {
  if (preferredZoneId) {
    const preferred = getAIZones(view).find((zone) => zone.id === preferredZoneId)
    if (preferred) return preferred
  }

  const pluginState = aiWriterPluginKey.getState(view.state)
  if (pluginState?.zoneId) {
    const localZone = getAIZones(view).find((zone) => zone.id === pluginState.zoneId)
    if (localZone) return localZone
  }

  return null
}

function upsertZoneMark(
  view: EditorView,
  from: number,
  to: number,
  attrs: AIZoneMarkAttrs,
  metaType?: string
): boolean {
  if (from >= to) return false

  const markType = getAIZoneMarkType(view)
  if (!markType) return false

  const tr = view.state.tr
  tr.removeMark(from, to, markType)
  tr.addMark(from, to, markType.create(attrs))

  if (metaType) {
    tr.setMeta(aiWriterPluginKey, { type: metaType })
  }

  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
  return true
}

function updateZoneMark(
  view: EditorView,
  zoneId: string,
  patch: ZoneMarkPatch,
  metaType?: string
): boolean {
  const zone = getAIZones(view).find((entry) => entry.id === zoneId)
  if (!zone || zone.from >= zone.to) return false

  const attrs = createZoneMarkAttrs(
    zone.id,
    patch.mode ?? zone.mode,
    patch.streaming ?? zone.streaming,
    patch.choices === undefined ? zone.choices : patch.choices,
    patch.deletedSlice === undefined ? zone.deletedSlice : patch.deletedSlice
  )

  return upsertZoneMark(view, zone.from, zone.to, attrs, metaType)
}

function selectionOverlapsAIZone(
  view: EditorView,
  selectionFrom: number,
  selectionTo: number
): boolean {
  if (selectionFrom >= selectionTo) return false

  for (const zone of getAIZones(view)) {
    if (selectionFrom < zone.to && selectionTo > zone.from) {
      return true
    }
  }

  return false
}

export function createAIWriterController(
  options: AIWriterControllerOptions = {}
): AIWriterController {
  let abortController: AbortController | null = null
  let currentRequestId = 0
  let streamedText = ''
  const onStreamingChange = options.onStreamingChange ?? null
  const getIncludeAfterContext = options.getIncludeAfterContext ?? (() => false)
  let currentView: EditorView | null = null

  const stuckDetector = new StuckDetector({
    onStuckStart() {
      if (!currentView) return
      const tr = currentView.state.tr.setMeta(aiWriterPluginKey, { type: 'stuck_start' })
      currentView.dispatch(tr)
    },
    onStuckStop() {
      if (!currentView) return
      const tr = currentView.state.tr.setMeta(aiWriterPluginKey, { type: 'stuck_stop' })
      currentView.dispatch(tr)
    },
  })

  function setStreamingState(streaming: boolean, view?: EditorView): void {
    onStreamingChange?.(streaming)
    if (!streaming && view) {
      stuckDetector.reset()
      currentView = null
      const pluginState = aiWriterPluginKey.getState(view.state)
      const updated =
        pluginState?.zoneId !== null && pluginState?.zoneId !== undefined
          ? updateZoneMark(view, pluginState.zoneId, { streaming: false }, 'streaming_stop')
          : false

      if (!updated) {
        const tr = view.state.tr.setMeta(aiWriterPluginKey, { type: 'streaming_stop' })
        tr.setMeta('addToHistory', false)
        view.dispatch(tr)
      }
    }
  }

  async function streamAI(view: EditorView, payload: StreamPayload): Promise<void> {
    abortController?.abort()
    const requestAbortController = new AbortController()
    abortController = requestAbortController
    const requestId = ++currentRequestId
    currentView = view
    stuckDetector.reset()
    setStreamingState(true)

    try {
      const response = await fetch('/api/ai/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: requestAbortController.signal,
      })

      if (!response.ok) {
        const message = await readErrorMessage(response)
        handleAIError(view, message)
        return
      }

      if (!response.body) {
        handleAIError(view, 'No stream returned from AI endpoint')
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (abortController === requestAbortController && !requestAbortController.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break

        if (value && !requestAbortController.signal.aborted) {
          const chunk = decoder.decode(value, { stream: true })
          if (chunk) {
            streamedText += chunk
            stuckDetector.onChunk()
            insertChunk(view, streamedText)
          }
        }

        const pluginState = aiWriterPluginKey.getState(view.state)
        if (!pluginState?.active) break
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      const message = error instanceof Error ? error.message : 'AI streaming error'
      handleAIError(view, message)
    } finally {
      if (requestId === currentRequestId && abortController === requestAbortController) {
        abortController = null
        setStreamingState(false, view)
      }
    }
  }

  async function streamAIPrompt(view: EditorView, payload: PromptStreamPayload): Promise<void> {
    abortController?.abort()
    const requestAbortController = new AbortController()
    abortController = requestAbortController
    const requestId = ++currentRequestId
    currentView = view
    stuckDetector.reset()
    setStreamingState(true)

    const pluginStateAtStart = aiWriterPluginKey.getState(view.state)
    const zoneId = pluginStateAtStart?.zoneId
    if (!zoneId) {
      handleAIError(view, 'AI zone failed to initialize')
      return
    }

    let detectedMode: AIMode | null = null
    let insertIndex: number | null = null
    const choices: string[] = []
    let bufferedContent = ''
    let selectionDeleted = false
    let deletedSlice: import('prosemirror-model').Slice | null = null

    const deleteSelection = () => {
      if (selectionDeleted) return
      const { selectionFrom, selectionTo } = payload
      if (selectionFrom < selectionTo) {
        deletedSlice = view.state.doc.slice(selectionFrom, selectionTo)
        const tr = view.state.tr.delete(selectionFrom, selectionTo)
        tr.setMeta('addToHistory', false)
        view.dispatch(tr)
        selectionDeleted = true
      }
    }

    try {
      const response = await fetch('/api/ai/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: requestAbortController.signal,
      })

      if (!response.ok) {
        const message = await readErrorMessage(response)
        handleAIError(view, message)
        return
      }

      if (!response.body) {
        handleAIError(view, 'No stream returned from AI endpoint')
        return
      }

      const modeHeader = response.headers.get('X-AI-Mode')
      const insertIndexHeader = response.headers.get('X-AI-Insert-Index')

      if (modeHeader && ['replace', 'insert', 'choices'].includes(modeHeader)) {
        detectedMode = modeHeader as AIMode
        if (insertIndexHeader) {
          const parsedInsertIndex = Number.parseInt(insertIndexHeader, 10)
          insertIndex = Number.isFinite(parsedInsertIndex) ? parsedInsertIndex : null
        } else {
          insertIndex = null
        }

        const tr = view.state.tr.setMeta(aiWriterPluginKey, {
          type: 'mode_detected',
          mode: detectedMode,
          insertIndex,
        })
        tr.setMeta('addToHistory', false)
        view.dispatch(tr)

        if (detectedMode === 'replace') {
          deleteSelection()
          const pluginState = aiWriterPluginKey.getState(view.state)
          const pos = pluginState?.originalSelectionFrom ?? payload.selectionFrom
          const zoneTr = view.state.tr.setMeta(aiWriterPluginKey, {
            type: 'zone_start',
            pos,
            deletedSlice,
            deletedFrom: deletedSlice ? pos : null,
          })
          zoneTr.setMeta('addToHistory', false)
          view.dispatch(zoneTr)
        } else if (detectedMode === 'insert') {
          const pluginState = aiWriterPluginKey.getState(view.state)
          const currentFrom = pluginState?.originalSelectionFrom ?? payload.selectionFrom
          const currentTo = pluginState?.originalSelectionTo ?? payload.selectionTo
          const selectionLength = currentTo - currentFrom

          let insertPos: number
          if (insertIndex === null || insertIndex === 0) insertPos = currentFrom
          else if (insertIndex < 0) insertPos = currentTo
          else insertPos = currentFrom + Math.min(insertIndex, selectionLength)

          const zoneTr = view.state.tr.setMeta(aiWriterPluginKey, {
            type: 'zone_start',
            pos: insertPos,
            deletedSlice: null,
            deletedFrom: null,
          })
          zoneTr.setMeta('addToHistory', false)
          view.dispatch(zoneTr)
        } else if (detectedMode === 'choices') {
          if (payload.selectionFrom < payload.selectionTo) {
            const attrs = createZoneMarkAttrs(zoneId, 'choices', true, [], null)
            const zoneSet = upsertZoneMark(
              view,
              payload.selectionFrom,
              payload.selectionTo,
              attrs,
              'zone_set'
            )

            if (!zoneSet) {
              const zoneTr = view.state.tr.setMeta(aiWriterPluginKey, {
                type: 'zone_set',
                from: payload.selectionFrom,
                to: payload.selectionTo,
              })
              zoneTr.setMeta('addToHistory', false)
              view.dispatch(zoneTr)
            }
          }
        }
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (abortController === requestAbortController && !requestAbortController.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break

        if (value && !requestAbortController.signal.aborted) {
          const chunk = decoder.decode(value, { stream: true })
          buffer += chunk

          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.trim()) continue

            try {
              const parsed = JSON.parse(line)
              stuckDetector.onChunk()

              if (detectedMode === 'replace' || detectedMode === 'insert') {
                bufferedContent += parsed
                insertChunk(view, bufferedContent)
              } else if (detectedMode === 'choices' && typeof parsed === 'string') {
                choices.push(parsed)
                updateZoneMark(view, zoneId, { choices: [...choices], streaming: true })
              }
            } catch {
              console.warn('Failed to parse AI stream chunk payload from AI endpoint', { line })
            }
          }
        }

        const pluginState = aiWriterPluginKey.getState(view.state)
        if (!pluginState?.active) break
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      const message = error instanceof Error ? error.message : 'AI streaming error'
      handleAIError(view, message)
    } finally {
      if (requestId === currentRequestId && abortController === requestAbortController) {
        abortController = null
        setStreamingState(false, view)
      }
    }
  }

  function handleAIError(view: EditorView, message: string): void {
    toast.error('AI generation failed', { description: message })

    const pluginState = aiWriterPluginKey.getState(view.state)
    const isEmpty = !pluginState?.active || pluginState.from === pluginState.to

    if (
      isEmpty &&
      pluginState?.active &&
      pluginState.mode === 'replace' &&
      pluginState.deletedSlice
    ) {
      rejectAI(view, pluginState.zoneId ?? undefined)
    } else if (isEmpty) {
      stopAI(view)
    } else {
      setStreamingState(false, view)
      abortController = null
    }
  }

  function stopAI(view: EditorView): void {
    stuckDetector.reset()
    currentView = null
    setStreamingState(false)
    streamedText = ''
    const tr = view.state.tr.setMeta(aiWriterPluginKey, { type: 'stop' })
    view.dispatch(tr)
  }

  function startAIContinuation(view: EditorView, at_doc_end: boolean): void {
    const pluginState = aiWriterPluginKey.getState(view.state)
    if (pluginState?.active && pluginState.streaming) {
      return
    }

    const pos = at_doc_end ? view.state.doc.content.size : view.state.selection.to
    const selection = view.state.selection
    if (!(selection.empty && selection.from === pos)) {
      const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos))
      tr.setMeta('addToHistory', false)
      view.dispatch(tr)
    }

    const zoneId = createZoneId()

    const tr = view.state.tr
    tr.setMeta(aiWriterPluginKey, { type: 'start', pos, zoneId })
    tr.setMeta('addToHistory', true)
    view.dispatch(tr)
    streamedText = ''

    const { contextBefore, contextAfter } = getDocumentContext(view, pos, getIncludeAfterContext())
    void streamAI(view, { mode: 'continue', contextBefore, contextAfter })
  }

  function startAIPromptAtRange(
    view: EditorView,
    prompt: string,
    selectionFrom: number,
    selectionTo: number
  ): boolean {
    const pluginState = aiWriterPluginKey.getState(view.state)
    if (pluginState?.active && pluginState.streaming) {
      toast.error('Finish the current AI generation before starting a new request')
      return false
    }

    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) {
      return false
    }

    const docSize = view.state.doc.content.size
    const clampedFrom = Math.max(0, Math.min(selectionFrom, docSize))
    const clampedTo = Math.max(0, Math.min(selectionTo, docSize))
    const from = Math.min(clampedFrom, clampedTo)
    const to = Math.max(clampedFrom, clampedTo)

    if (selectionOverlapsAIZone(view, from, to)) {
      toast.error('Selection overlaps an active AI zone. Select different text and try again.')
      return false
    }

    const selectedText = from < to ? view.state.doc.textBetween(from, to, '\n\n', '\n') : undefined
    const zoneId = createZoneId()

    const tr = view.state.tr
    tr.setMeta(aiWriterPluginKey, {
      type: 'start',
      pos: from,
      zoneId,
      deletedSlice: null,
      selectionFrom: from,
      selectionTo: to,
    })
    tr.setMeta('addToHistory', true)
    view.dispatch(tr)
    streamedText = ''

    const { contextBefore, contextAfter } = getDocumentContext(view, from, getIncludeAfterContext())
    void streamAIPrompt(view, {
      mode: 'prompt',
      contextBefore,
      contextAfter,
      prompt: trimmedPrompt,
      selectedText,
      selectionFrom: from,
      selectionTo: to,
    })

    return true
  }

  function acceptAI(view: EditorView, zoneId?: string): void {
    const pluginState = aiWriterPluginKey.getState(view.state)

    abortController?.abort()
    abortController = null
    streamedText = ''
    stuckDetector.reset()
    currentView = null
    onStreamingChange?.(false)

    const zone = getTargetZone(view, zoneId)
    if (zone) {
      const markType = getAIZoneMarkType(view)
      const tr = view.state.tr
      if (markType) {
        tr.removeMark(zone.from, zone.to, markType)
      }
      tr.setMeta(aiWriterPluginKey, { type: 'accept' })
      tr.setMeta('addToHistory', true)
      view.dispatch(tr)
      return
    }

    if (pluginState?.active) {
      const tr = view.state.tr.setMeta(aiWriterPluginKey, { type: 'accept' })
      tr.setMeta('addToHistory', true)
      view.dispatch(tr)
    }
  }

  function rejectAI(view: EditorView, zoneId?: string): void {
    const pluginState = aiWriterPluginKey.getState(view.state)

    abortController?.abort()
    abortController = null
    streamedText = ''
    stuckDetector.reset()
    currentView = null
    onStreamingChange?.(false)

    const zone = getTargetZone(view, zoneId)
    if (!zone) {
      if (pluginState?.active) {
        const tr = view.state.tr

        if (pluginState.mode === 'replace') {
          if (
            pluginState.from !== null &&
            pluginState.to !== null &&
            pluginState.from < pluginState.to
          ) {
            tr.delete(pluginState.from, pluginState.to)
          }

          const deletedFrom = pluginState.deletedFrom ?? pluginState.from
          if (pluginState.deletedSlice && deletedFrom !== null) {
            tr.replace(deletedFrom, deletedFrom, pluginState.deletedSlice)
          }
        } else if (
          pluginState.from !== null &&
          pluginState.to !== null &&
          pluginState.from < pluginState.to
        ) {
          tr.delete(pluginState.from, pluginState.to)
        }

        tr.setMeta(aiWriterPluginKey, { type: 'reject' })
        tr.setMeta('addToHistory', true)
        view.dispatch(tr)
      }
      return
    }

    const tr = view.state.tr
    const markType = getAIZoneMarkType(view)

    if (zone.mode === 'choices') {
      if (markType) {
        tr.removeMark(zone.from, zone.to, markType)
      }
    } else {
      if (zone.from < zone.to) {
        tr.delete(zone.from, zone.to)
      }

      if (zone.mode === 'replace') {
        const deletedSlice =
          deserializeDeletedSlice(view, zone.deletedSlice) ??
          (pluginState?.zoneId === zone.id ? pluginState.deletedSlice : null)

        if (deletedSlice) {
          tr.replace(zone.from, zone.from, deletedSlice)
        }
      }
    }

    tr.setMeta(aiWriterPluginKey, { type: 'reject' })
    tr.setMeta('addToHistory', true)
    view.dispatch(tr)
  }

  function cancelAI(view?: EditorView): void {
    abortController?.abort()
    abortController = null
    streamedText = ''
    stuckDetector.reset()
    currentView = null
    if (view) {
      setStreamingState(false, view)
    } else {
      setStreamingState(false)
    }
  }

  return {
    startAIContinuation,
    startAIPromptAtRange,
    acceptAI,
    rejectAI,
    cancelAI,
  }
}

function getDocumentContext(
  view: EditorView,
  pos: number,
  includeAfter: boolean
): { contextBefore: string; contextAfter?: string } {
  const docEnd = view.state.doc.content.size

  const contextBefore = view.state.doc.textBetween(0, pos, '\n\n', '\n')

  if (!includeAfter || pos >= docEnd) {
    return { contextBefore }
  }

  const contextAfter = view.state.doc.textBetween(pos, docEnd, '\n\n', '\n')
  return { contextBefore, contextAfter }
}

interface StreamPayload {
  mode: 'continue' | 'prompt'
  contextBefore: string
  contextAfter?: string
  prompt?: string
  selectedText?: string
}

interface PromptStreamPayload extends StreamPayload {
  mode: 'prompt'
  prompt: string
  selectionFrom: number
  selectionTo: number
}

function insertChunk(view: EditorView, generatedText: string): void {
  const pluginState = aiWriterPluginKey.getState(view.state)
  if (
    !pluginState?.active ||
    !pluginState.zoneId ||
    pluginState.from === null ||
    pluginState.to === null ||
    pluginState.from > pluginState.to
  ) {
    return
  }

  const $from = view.state.doc.resolve(pluginState.from)
  const $to = view.state.doc.resolve(pluginState.to)
  const content = parseMarkdownishToSlice(generatedText, {
    openStart: $from.parent.inlineContent,
    openEnd: $to.parent.inlineContent,
  })

  const tr = view.state.tr
  tr.replaceRange(pluginState.from, pluginState.to, content)

  const markType = getAIZoneMarkType(view)
  const zoneFrom = tr.mapping.map(pluginState.from, -1)
  const zoneTo = tr.mapping.map(pluginState.to, 1)
  if (markType && zoneTo > zoneFrom) {
    tr.addMark(
      zoneFrom,
      zoneTo,
      markType.create(
        createZoneMarkAttrs(
          pluginState.zoneId,
          pluginState.mode ?? 'insert',
          true,
          null,
          pluginState.deletedSlice ? JSON.stringify(pluginState.deletedSlice.toJSON()) : null
        )
      )
    )
  }

  tr.setMeta(aiWriterPluginKey, { type: 'chunk' })
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const body = (await response.json()) as { message?: unknown }
      if (typeof body.message === 'string' && body.message.trim()) {
        return body.message
      }
    }

    const text = await response.text()
    if (text.trim()) {
      return text
    }
  } catch {
    return `AI request failed with status ${response.status}`
  }

  return `AI request failed with status ${response.status}`
}
