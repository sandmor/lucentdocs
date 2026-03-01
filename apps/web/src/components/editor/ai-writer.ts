import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema, type UIMessage } from 'ai'
import { Slice, type MarkType } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { toast } from 'sonner'
import { parseInlineZoneWriteAction, type InlineZoneWriteAction } from '@plotline/shared'
import { aiWriterPluginKey, getAIZones, type AIZone } from './ai-writer-plugin'
import {
  extractMessageTextFromPartsRaw,
  extractToolPartsFromParts,
  getMessageParts,
} from './ai-message-parts'
import type { InlineChatMessage, InlineZoneSession } from './inline-ai-session'
import { StuckDetector } from './ai-writer-stuck-detector'
import { parseMarkdownishToSlice } from './markdownish'

type StreamingHandler = (streaming: boolean) => void

interface AIWriterControllerOptions {
  onStreamingChange?: StreamingHandler
  getIncludeAfterContext?: () => boolean
  getToolScope?: () => { projectId?: string; documentId?: string }
}

interface AIZoneMarkAttrs {
  id: string
  streaming: boolean
  session: string | null
  deletedSlice: string | null
}

interface ZoneMarkPatch {
  streaming?: boolean
  session?: InlineZoneSession | null
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
  continueAIPromptForZone: (view: EditorView, zoneId: string, prompt: string) => boolean
  dismissChoicesForZone: (view: EditorView, zoneId: string) => boolean
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

function createInlineMessageId(role: 'user' | 'assistant'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `inline-${role}-${crypto.randomUUID()}`
  }

  return `inline-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function getAIZoneMarkType(view: EditorView): MarkType | null {
  return view.state.schema.marks.ai_zone ?? null
}

function createEmptySession(): InlineZoneSession {
  return {
    messages: [],
    choices: [],
    contextBefore: null,
    contextAfter: null,
  }
}

function createSessionWithPromptContext(
  contextBefore: string,
  contextAfter: string | null
): InlineZoneSession {
  return {
    messages: [],
    choices: [],
    contextBefore,
    contextAfter,
  }
}

function createZoneMarkAttrs(
  zoneId: string,
  streaming: boolean,
  session: InlineZoneSession | null,
  deletedSlice: string | null
): AIZoneMarkAttrs {
  return {
    id: zoneId,
    streaming,
    session: session ? JSON.stringify(session) : null,
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
    patch.streaming ?? zone.streaming,
    patch.session === undefined ? zone.session : patch.session,
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
  const getToolScope =
    options.getToolScope ??
    (() => ({
      projectId: undefined,
      documentId: undefined,
    }))
  let currentView: EditorView | null = null

  const updateZoneSession = (
    view: EditorView,
    zoneId: string,
    updater: (current: InlineZoneSession) => InlineZoneSession
  ) => {
    const zone = getAIZones(view).find((entry) => entry.id === zoneId)
    if (!zone) return
    updateZoneMark(view, zoneId, {
      session: updater(zone.session ?? createEmptySession()),
    })
  }

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

  async function streamAIPrompt(
    view: EditorView,
    payload: PromptStreamPayload,
    zoneId: string,
    userPrompt: string
  ): Promise<void> {
    const initialZone = getAIZones(view).find((entry) => entry.id === zoneId)
    const priorConversation = serializeInlineConversation(initialZone?.session)

    abortController?.abort()
    const requestAbortController = new AbortController()
    abortController = requestAbortController
    const requestId = ++currentRequestId
    currentView = view
    stuckDetector.reset()
    setStreamingState(true)

    updateZoneSession(view, zoneId, (current) => ({
      ...current,
      messages: [
        ...current.messages,
        {
          id: createInlineMessageId('user'),
          role: 'user',
          text: userPrompt,
          tools: [],
        },
      ],
    }))

    try {
      const toolScope = getToolScope()
      const response = await fetch('/api/ai/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          conversation: priorConversation,
          projectId: toolScope.projectId,
          documentId: toolScope.documentId,
        }),
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
      const streamVersion = response.headers.get('x-vercel-ai-ui-message-stream')
      if (streamVersion !== 'v1') {
        handleAIError(view, 'Inline AI stream format is unsupported by this client')
        return
      }

      let assistantTextBuffer = ''
      let hasZoneAction = false
      const appliedZoneActionCalls = new Set<string>()
      let validChunkCount = 0
      let parseFailureCount = 0

      const applyAssistantTextFallback = () => {
        if (hasZoneAction) return
        if (!assistantTextBuffer.trim()) return

        const zone = getAIZones(view).find((entry) => entry.id === zoneId)
        if (!zone) return

        applyInlineZoneAction(view, zoneId, {
          type: 'replace_range',
          fromOffset: 0,
          toOffset: Math.max(0, zone.to - zone.from),
          content: assistantTextBuffer,
        })
        hasZoneAction = true
      }

      const upsertAssistantMessage = (
        updater: (assistant: InlineChatMessage) => InlineChatMessage
      ) => {
        updateZoneSession(view, zoneId, (current) => {
          const messages = [...current.messages]
          const last = messages[messages.length - 1]
          const assistant: InlineChatMessage =
            last?.role === 'assistant'
              ? last
              : {
                  id: createInlineMessageId('assistant'),
                  role: 'assistant',
                  text: '',
                  tools: [],
                }
          const nextAssistant = updater(assistant)
          if (last?.role === 'assistant') {
            messages[messages.length - 1] = nextAssistant
          } else {
            messages.push(nextAssistant)
          }
          return {
            ...current,
            messages,
          }
        })
      }

      const parsedUiMessageChunkStream = parseJsonEventStream({
        stream: response.body,
        schema: uiMessageChunkSchema,
      }).pipeThrough(
        new TransformStream({
          transform(parseResult, controller) {
            if (parseResult.success) {
              validChunkCount += 1
              controller.enqueue(parseResult.value)
              return
            }
            parseFailureCount += 1

            console.warn('Failed to parse inline AI UI stream chunk', {
              error: parseResult.error,
              rawValue: parseResult.rawValue,
            })
          },
        })
      )

      for await (const assistantMessage of readUIMessageStream<UIMessage>({
        stream: parsedUiMessageChunkStream,
        onError: (error) => {
          console.warn('Failed to read inline AI UI message stream', { error })
        },
      })) {
        if (abortController !== requestAbortController || requestAbortController.signal.aborted) break
        stuckDetector.onChunk()

        const parts = getMessageParts(assistantMessage)
        const nextAssistantText = extractMessageTextFromPartsRaw(parts)
        if (nextAssistantText !== assistantTextBuffer) {
          assistantTextBuffer = nextAssistantText
          upsertAssistantMessage((assistant) => ({
            ...assistant,
            text: nextAssistantText,
          }))
        }

        const toolParts = extractToolPartsFromParts(parts)
        for (const toolPart of toolParts) {
          const parsedTool = parseInlineToolPart(toolPart)
          if (!parsedTool) continue

          const { toolName, toolCallId, rawState, chipState } = parsedTool
          const isZoneWriteTool = toolName === 'write_zone' || toolName === 'write_zone_choices'

          if (isZoneWriteTool && rawState === 'output-available') {
            const action = parseInlineZoneActionFromToolPart(toolPart)
            if (action) {
              const actionKey = `${toolName}:${toolCallId}`
              if (!appliedZoneActionCalls.has(actionKey)) {
                appliedZoneActionCalls.add(actionKey)
                applyInlineZoneAction(view, zoneId, action)
                hasZoneAction = true
              }
            }
            continue
          }

          if (isZoneWriteTool) continue
          upsertAssistantMessage((assistant) => {
            const nextTools = [...assistant.tools]
            const existingIndex = nextTools.findIndex((tool) => tool.toolName === toolName)
            if (existingIndex >= 0) {
              nextTools[existingIndex] = {
                ...nextTools[existingIndex],
                state: chipState,
              }
            } else {
              nextTools.push({
                toolName,
                state: chipState,
              })
            }
            return {
              ...assistant,
              tools: nextTools,
            }
          })
        }

        const pluginState = aiWriterPluginKey.getState(view.state)
        if (!pluginState?.active) break
      }

      if (validChunkCount === 0 && parseFailureCount > 0) {
        throw new Error('Inline AI stream returned invalid event data')
      }

      applyAssistantTextFallback()
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

  function applyInlineZoneAction(view: EditorView, zoneId: string, action: InlineZoneWriteAction) {
    const zone = getAIZones(view).find((entry) => entry.id === zoneId)
    if (!zone) return

    if (action.type === 'set_choices') {
      updateZoneSession(view, zoneId, (current) => ({
        ...current,
        choices: action.choices,
      }))
      updateZoneMark(view, zoneId, {
        streaming: true,
      })
      return
    }

    const zoneLength = zone.to - zone.from
    const fromOffset = Math.max(0, Math.min(action.fromOffset, zoneLength))
    const toOffset = Math.max(fromOffset, Math.min(action.toOffset, zoneLength))
    const replaceFrom = zone.from + fromOffset
    const replaceTo = zone.from + toOffset

    const fromResolved = view.state.doc.resolve(replaceFrom)
    const toResolved = view.state.doc.resolve(replaceTo)
    const replacement = parseMarkdownishToSlice(action.content, {
      openStart: fromResolved.parent.inlineContent,
      openEnd: toResolved.parent.inlineContent,
    })

    const tr = view.state.tr
    tr.replaceRange(replaceFrom, replaceTo, replacement)

    const markType = getAIZoneMarkType(view)
    if (markType) {
      const nextZoneFrom = tr.mapping.map(zone.from, -1)
      const nextZoneTo = tr.mapping.map(zone.to, 1)
      if (nextZoneTo > nextZoneFrom) {
        tr.removeMark(nextZoneFrom, nextZoneTo, markType)
        tr.addMark(
          nextZoneFrom,
          nextZoneTo,
          markType.create(createZoneMarkAttrs(zone.id, true, zone.session, zone.deletedSlice))
        )
      }
    }

    tr.setMeta(aiWriterPluginKey, { type: 'chunk' })
    tr.setMeta('addToHistory', false)
    view.dispatch(tr)
  }

  function handleAIError(view: EditorView, message: string): void {
    toast.error('AI generation failed', { description: message })

    const pluginState = aiWriterPluginKey.getState(view.state)
    const isEmpty = !pluginState?.active || pluginState.from === pluginState.to

    if (isEmpty && pluginState?.active && pluginState.deletedSlice) {
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
    tr.setMeta('addToHistory', false)
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

    const selectedText = from < to ? view.state.doc.textBetween(from, to, '\n\n', '\n') : ''
    const deletedSlice = from < to ? view.state.doc.slice(from, to) : null
    const zoneId = createZoneId()
    const { contextBefore, contextAfter } = getPromptContextForRange(
      view,
      from,
      to,
      getIncludeAfterContext()
    )

    const tr = view.state.tr
    tr.setMeta(aiWriterPluginKey, {
      type: 'start',
      pos: from,
      zoneId,
      deletedSlice,
      selectionFrom: from,
      selectionTo: to,
    })
    if (from < to) {
      const zoneAttrs = createZoneMarkAttrs(
        zoneId,
        true,
        createSessionWithPromptContext(contextBefore, contextAfter ?? null),
        deletedSlice ? JSON.stringify(deletedSlice.toJSON()) : null
      )
      const markType = getAIZoneMarkType(view)
      if (markType) {
        tr.removeMark(from, to, markType)
        tr.addMark(from, to, markType.create(zoneAttrs))
      }
    }
    tr.setMeta('addToHistory', true)
    view.dispatch(tr)
    streamedText = ''

    void streamAIPrompt(
      view,
      {
        mode: 'prompt',
        contextBefore,
        contextAfter,
        prompt: trimmedPrompt,
        selectedText: selectedText || undefined,
        selectionFrom: from,
        selectionTo: to,
      },
      zoneId,
      trimmedPrompt
    )

    return true
  }

  function continueAIPromptForZone(view: EditorView, zoneId: string, prompt: string): boolean {
    const zone = getAIZones(view).find((entry) => entry.id === zoneId)
    if (!zone) return false

    const pluginState = aiWriterPluginKey.getState(view.state)
    if (pluginState?.active && pluginState.streaming) {
      toast.error('Finish the current AI generation before starting a new request')
      return false
    }

    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) return false

    const tr = view.state.tr
    tr.setMeta(aiWriterPluginKey, {
      type: 'start',
      pos: zone.from,
      zoneId,
      deletedSlice: deserializeDeletedSlice(view, zone.deletedSlice),
      selectionFrom: zone.from,
      selectionTo: zone.to,
    })
    tr.setMeta('addToHistory', false)
    view.dispatch(tr)

    updateZoneMark(view, zoneId, {
      streaming: true,
    })

    const selectedText = view.state.doc.textBetween(zone.from, zone.to, '\n\n', '\n')
    const fallbackContext = getPromptContextForRange(
      view,
      zone.from,
      zone.to,
      getIncludeAfterContext()
    )
    const contextBefore = zone.session?.contextBefore ?? fallbackContext.contextBefore
    const contextAfter = zone.session?.contextAfter ?? fallbackContext.contextAfter ?? null
    void streamAIPrompt(
      view,
      {
        mode: 'prompt',
        contextBefore,
        contextAfter: contextAfter ?? undefined,
        prompt: trimmedPrompt,
        selectedText,
        selectionFrom: zone.from,
        selectionTo: zone.to,
      },
      zoneId,
      trimmedPrompt
    )

    return true
  }

  function dismissChoicesForZone(view: EditorView, zoneId: string): boolean {
    const zone = getAIZones(view).find((entry) => entry.id === zoneId)
    if (!zone) return false

    if (!zone.session || zone.session.choices.length === 0) {
      return false
    }

    updateZoneSession(view, zoneId, (current) => ({
      ...current,
      choices: [],
    }))
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
      tr.setMeta('addToHistory', false)
      view.dispatch(tr)
      return
    }

    if (pluginState?.active) {
      const tr = view.state.tr.setMeta(aiWriterPluginKey, { type: 'accept' })
      tr.setMeta('addToHistory', false)
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

        tr.setMeta(aiWriterPluginKey, { type: 'reject' })
        tr.setMeta('addToHistory', false)
        view.dispatch(tr)
      }
      return
    }

    const tr = view.state.tr
    const markType = getAIZoneMarkType(view)

    const trackedFrom =
      pluginState?.zoneId === zone.id && pluginState.from !== null ? pluginState.from : null
    const trackedTo =
      pluginState?.zoneId === zone.id && pluginState.to !== null ? pluginState.to : null
    const deleteFrom = trackedFrom !== null ? Math.min(zone.from, trackedFrom) : zone.from
    const deleteTo = trackedTo !== null ? Math.max(zone.to, trackedTo) : zone.to

    const deletedSlice =
      deserializeDeletedSlice(view, zone.deletedSlice) ??
      (pluginState?.zoneId === zone.id ? pluginState.deletedSlice : null)

    if (deleteFrom < deleteTo) {
      tr.delete(deleteFrom, deleteTo)
    }

    if (deletedSlice) {
      tr.replace(deleteFrom, deleteFrom, deletedSlice)
    }

    if (markType) {
      const removeTo = deleteFrom + (deletedSlice?.content.size ?? 0)
      tr.removeMark(deleteFrom, Math.max(deleteFrom, removeTo), markType)
    }

    tr.setMeta(aiWriterPluginKey, { type: 'reject' })
    tr.setMeta('addToHistory', false)
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
    continueAIPromptForZone,
    dismissChoicesForZone,
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

function getPromptContextForRange(
  view: EditorView,
  from: number,
  to: number,
  includeAfter: boolean
): { contextBefore: string; contextAfter?: string } {
  const docEnd = view.state.doc.content.size
  const safeFrom = Math.max(0, Math.min(from, docEnd))
  const safeTo = Math.max(safeFrom, Math.min(to, docEnd))

  const contextBefore = view.state.doc.textBetween(0, safeFrom, '\n\n', '\n')
  if (!includeAfter || safeTo >= docEnd) {
    return { contextBefore }
  }

  const contextAfter = view.state.doc.textBetween(safeTo, docEnd, '\n\n', '\n')
  return { contextBefore, contextAfter }
}

interface StreamPayload {
  mode: 'continue' | 'prompt'
  contextBefore: string
  contextAfter?: string
  prompt?: string
  selectedText?: string
  conversation?: string
}

interface PromptStreamPayload extends StreamPayload {
  mode: 'prompt'
  prompt: string
  selectionFrom: number
  selectionTo: number
}

function parseInlineZoneActionFromToolPart(part: Record<string, unknown>): InlineZoneWriteAction | null {
  const output =
    typeof part.output === 'object' && part.output !== null && !Array.isArray(part.output)
      ? (part.output as Record<string, unknown>)
      : null
  if (!output) return null

  const applied =
    typeof output.applied === 'object' && output.applied !== null && !Array.isArray(output.applied)
      ? output.applied
      : output

  return parseInlineZoneWriteAction(applied)
}

function parseInlineToolPart(part: Record<string, unknown>): {
  toolName: string
  toolCallId: string
  rawState: string
  chipState: 'pending' | 'complete'
} | null {
  const partType = typeof part.type === 'string' ? part.type : ''
  const toolName =
    partType === 'dynamic-tool'
      ? typeof part.toolName === 'string'
        ? part.toolName
        : null
      : partType.startsWith('tool-')
        ? partType.replace(/^tool-/, '')
        : null
  if (!toolName) return null

  const rawState = typeof part.state === 'string' ? part.state : 'unknown'
  const chipState: 'pending' | 'complete' =
    rawState === 'output-available' ? 'complete' : 'pending'
  const toolCallId = typeof part.toolCallId === 'string' ? part.toolCallId : toolName

  return {
    toolName,
    toolCallId,
    rawState,
    chipState,
  }
}

function serializeInlineConversation(session: InlineZoneSession | null | undefined): string {
  if (!session?.messages || session.messages.length === 0) {
    return ''
  }

  return session.messages
    .map((message) => {
      const role = message.role === 'user' ? 'User' : 'Assistant'
      const text = message.text?.trim() ?? ''
      if (!text) return ''
      return `${role}: ${text}`
    })
    .filter((entry) => entry.length > 0)
    .join('\n')
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
  const activeZone = getAIZones(view).find((zone) => zone.id === pluginState.zoneId)
  if (markType && zoneTo > zoneFrom) {
    tr.addMark(
      zoneFrom,
      zoneTo,
      markType.create(
        createZoneMarkAttrs(
          pluginState.zoneId,
          true,
          activeZone?.session ?? createEmptySession(),
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
