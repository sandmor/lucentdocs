import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'
import { TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { toast } from 'sonner'
import type { InlineZoneWriteAction } from '@plotline/shared'
import { aiWriterPluginKey, getAIZones } from './writer-plugin'
import {
  extractMessageTextFromPartsRaw,
  extractToolPartsFromParts,
  getMessageParts,
} from './message-parts'
import type { InlineChatMessage, InlineZoneSession } from '@plotline/shared'
import { StuckDetector } from './stuck-detector'
import { parseMarkdownishToSlice } from '../prosemirror/markdownish'
import {
  getDocumentContext,
  getPromptContextForRange,
  serializeInlineConversation,
} from './writer/context'
import { createInlineMessageId, createInlineSessionId, createZoneId } from './writer/ids'
import { createEmptySession, createSessionWithPromptContext } from './writer/session-state'
import { insertChunk, readErrorMessage } from './writer/stream'
import { parseInlineToolPart, parseInlineZoneActionFromToolPart } from './writer/tool-parts'
import {
  createZoneMarkAttrs,
  deserializeDeletedSlice,
  getAIZoneMarkType,
  getTargetZone,
  selectionOverlapsAIZone,
  updateZoneMark,
} from './writer/zone-marks'
import type {
  AIWriterController,
  AIWriterControllerOptions,
  PromptStreamPayload,
  StreamPayload,
} from './writer/types'
import { getTrpcProxyClient } from '@/lib/trpc'

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
  const getSessionById = options.getSessionById ?? (() => null)
  const setSessionById = options.setSessionById ?? (() => { })
  let currentView: EditorView | null = null
  const trpcClient = getTrpcProxyClient()

  const pruneInlineOrphans = () => {
    const toolScope = getToolScope()
    if (!toolScope.projectId || !toolScope.documentId) return
    void trpcClient.inline.pruneOrphans
      .mutate({
        projectId: toolScope.projectId,
        documentId: toolScope.documentId,
      })
      .catch(() => { })
  }

  const updateZoneSession = (
    sessionId: string,
    updater: (current: InlineZoneSession) => InlineZoneSession
  ) => {
    const currentSession = getSessionById(sessionId) ?? createEmptySession()
    setSessionById(sessionId, updater(currentSession))
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
    sessionId: string,
    userPrompt: string
  ): Promise<void> {
    abortController?.abort()
    const requestAbortController = new AbortController()
    abortController = requestAbortController
    const requestId = ++currentRequestId
    currentView = view
    stuckDetector.reset()
    setStreamingState(true)

    let observeUnsubscribe: { unsubscribe: () => void } | null = null
    let streamChunkController: ReadableStreamDefaultController<UIMessageChunk> | null = null
    let streamReadTask: Promise<void> | null = null
    let activeGenerationId: string | null = null
    let sessionDraft = getSessionById(sessionId) ?? createEmptySession()
    let sessionFlushQueued = false
    let sessionFlushVersion = 0

    try {
      const toolScope = getToolScope()
      if (!toolScope.projectId || !toolScope.documentId) {
        handleAIError(view, 'Inline AI streaming requires project and document scope')
        return
      }

      let assistantTextBuffer = ''
      const appliedZoneActionCalls = new Set<string>()
      let resolveGenerationDone: (() => void) | null = null
      let rejectGenerationDone: ((error: Error) => void) | null = null

      const flushSessionDraft = () => {
        setSessionById(sessionId, sessionDraft)
      }

      const queueSessionFlush = () => {
        if (sessionFlushQueued) return
        sessionFlushQueued = true
        const version = ++sessionFlushVersion
        queueMicrotask(() => {
          if (!sessionFlushQueued || version !== sessionFlushVersion) return
          sessionFlushQueued = false
          flushSessionDraft()
        })
      }

      const updateSessionDraft = (
        updater: (current: InlineZoneSession) => InlineZoneSession,
        options: { immediate?: boolean } = {}
      ) => {
        sessionDraft = updater(sessionDraft)
        if (options.immediate) {
          sessionFlushQueued = false
          sessionFlushVersion += 1
          flushSessionDraft()
          return
        }
        queueSessionFlush()
      }

      updateSessionDraft(
        (current) => ({
          ...current,
          contextBefore: current.contextBefore ?? payload.contextBefore,
          contextAfter: current.contextAfter ?? payload.contextAfter ?? null,
          messages: [
            ...current.messages,
            {
              id: createInlineMessageId('user'),
              role: 'user',
              text: userPrompt,
              tools: [],
            },
          ],
        }),
        { immediate: true }
      )

      const upsertAssistantMessage = (
        updater: (assistant: InlineChatMessage) => InlineChatMessage,
        options: { immediate?: boolean } = {}
      ) => {
        updateSessionDraft((current) => {
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
        }, options)
      }

      const chunkStream = new ReadableStream<UIMessageChunk>({
        start(controller) {
          streamChunkController = controller
        },
      })

      const generationDone = new Promise<void>((resolve, reject) => {
        resolveGenerationDone = resolve
        rejectGenerationDone = reject
      })

      streamReadTask = (async () => {
        let latestAssistant: UIMessage | null = null
        for await (const assistantMessage of readUIMessageStream<UIMessage>({
          message: latestAssistant ?? undefined,
          stream: chunkStream,
          terminateOnError: false,
          onError: (error) => {
            console.warn('Failed to read inline AI UI message stream', { error })
          },
        })) {
          latestAssistant = assistantMessage
          if (abortController !== requestAbortController || requestAbortController.signal.aborted) {
            break
          }
          stuckDetector.onChunk()

          const parts = getMessageParts(assistantMessage)
          const nextAssistantText = extractMessageTextFromPartsRaw(parts)
          if (nextAssistantText !== assistantTextBuffer) {
            assistantTextBuffer = nextAssistantText
            upsertAssistantMessage(
              (assistant) => ({
                ...assistant,
                text: nextAssistantText,
              }),
              { immediate: true }
            )
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
                  applyInlineZoneAction(view, zoneId, sessionId, action)
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
      })()

      observeUnsubscribe = trpcClient.inline.observeSession.subscribe(
        {
          projectId: toolScope.projectId,
          documentId: toolScope.documentId,
          sessionId,
        },
        {
          onData: (event) => {
            if (requestAbortController.signal.aborted) return
            if (event.type === 'stream-chunk') {
              if (!activeGenerationId) {
                activeGenerationId = event.generationId
              } else if (activeGenerationId !== event.generationId) {
                return
              }

              const chunkRecord = event.chunk as Record<string, unknown>
              if (
                chunkRecord.type === 'text-delta' &&
                typeof chunkRecord.delta === 'string' &&
                chunkRecord.delta.length > 0
              ) {
                // Let the streamReadTask handle the text updates entirely to avoid thrashing and race conditions
              }

              try {
                streamChunkController?.enqueue(event.chunk)
              } catch (error) {
                console.warn('Failed to enqueue inline stream chunk', { error })
              }
              return
            }

            if (!activeGenerationId && event.generating && event.generationId) {
              activeGenerationId = event.generationId
            }

            if (event.session) {
              if (activeGenerationId !== null) return
              updateSessionDraft(() => event.session!, { immediate: true })
            }

            if (activeGenerationId && !event.generating) {
              resolveGenerationDone?.()
            }
          },
          onError: (error) => {
            rejectGenerationDone?.(
              error instanceof Error ? error : new Error('Inline stream subscription failed')
            )
          },
        }
      )

      requestAbortController.signal.addEventListener(
        'abort',
        () => {
          if (!activeGenerationId) return
          void trpcClient.inline.cancelGeneration
            .mutate({
              projectId: toolScope.projectId!,
              documentId: toolScope.documentId!,
              sessionId,
            })
            .catch(() => { })
        },
        { once: true }
      )

      await trpcClient.inline.saveSession.mutate({
        projectId: toolScope.projectId,
        documentId: toolScope.documentId,
        sessionId,
        session: sessionDraft,
      })

      const started = await trpcClient.inline.startPromptGeneration.mutate({
        projectId: toolScope.projectId,
        documentId: toolScope.documentId,
        sessionId,
        contextBefore: payload.contextBefore,
        contextAfter: payload.contextAfter,
        prompt: payload.prompt,
        selectedText: payload.selectedText,
        conversation: serializeInlineConversation(sessionDraft),
      })
      activeGenerationId = started.generationId

      await generationDone
      updateSessionDraft((current) => current, { immediate: true })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      const message = error instanceof Error ? error.message : 'AI streaming error'
      handleAIError(view, message)
    } finally {
      observeUnsubscribe?.unsubscribe()
      if (sessionFlushQueued) {
        sessionFlushQueued = false
        sessionFlushVersion += 1
        setSessionById(sessionId, sessionDraft)
      }
      try {
        ; (streamChunkController as { close: () => void } | null)?.close()
      } catch {
        // ignore close races
      }
      if (streamReadTask) {
        try {
          await streamReadTask
        } catch (error) {
          console.warn('Failed to finalize inline stream reader', error)
        }
      }

      if (requestId === currentRequestId && abortController === requestAbortController) {
        const toolScope = getToolScope()
        const finalSession = sessionDraft
        if (toolScope.projectId && toolScope.documentId && finalSession) {
          void trpcClient.inline.saveSession
            .mutate({
              projectId: toolScope.projectId,
              documentId: toolScope.documentId,
              sessionId,
              session: finalSession,
            })
            .catch((saveError) => {
              console.warn('Failed to persist inline session state', saveError)
            })
        }

        abortController = null
        setStreamingState(false, view)
      }
    }
  }

  function applyInlineZoneAction(
    view: EditorView,
    zoneId: string,
    sessionId: string,
    action: InlineZoneWriteAction
  ) {
    const zone = getAIZones(view).find((entry) => entry.id === zoneId)
    if (!zone) return

    if (action.type === 'set_choices') {
      updateZoneSession(sessionId, (current) => ({
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
          markType.create(createZoneMarkAttrs(zone.id, true, zone.sessionId, zone.deletedSlice))
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
    const sessionId = createInlineSessionId()
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
      sessionId,
      deletedSlice,
      selectionFrom: from,
      selectionTo: to,
    })
    if (from < to) {
      const zoneAttrs = createZoneMarkAttrs(
        zoneId,
        true,
        sessionId,
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
    setSessionById(sessionId, createSessionWithPromptContext(contextBefore, contextAfter ?? null))
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
      sessionId,
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
    const sessionId = zone.sessionId ?? createInlineSessionId()

    const tr = view.state.tr
    tr.setMeta(aiWriterPluginKey, {
      type: 'start',
      pos: zone.from,
      zoneId,
      sessionId,
      deletedSlice: deserializeDeletedSlice(view, zone.deletedSlice),
      selectionFrom: zone.from,
      selectionTo: zone.to,
    })
    tr.setMeta('addToHistory', false)
    view.dispatch(tr)

    updateZoneMark(view, zoneId, {
      streaming: true,
      sessionId,
    })

    const selectedText = view.state.doc.textBetween(zone.from, zone.to, '\n\n', '\n')
    const fallbackContext = getPromptContextForRange(
      view,
      zone.from,
      zone.to,
      getIncludeAfterContext()
    )
    const zoneSession = zone.sessionId ? getSessionById(zone.sessionId) : null
    const contextBefore = zoneSession?.contextBefore ?? fallbackContext.contextBefore
    const contextAfter = zoneSession?.contextAfter ?? fallbackContext.contextAfter ?? null
    if (!zoneSession) {
      setSessionById(sessionId, createSessionWithPromptContext(contextBefore, contextAfter))
    }
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
      sessionId,
      trimmedPrompt
    )

    return true
  }

  function dismissChoicesForZone(view: EditorView, zoneId: string): boolean {
    const zone = getAIZones(view).find((entry) => entry.id === zoneId)
    if (!zone) return false
    if (!zone.sessionId) return false

    const zoneSession = getSessionById(zone.sessionId)
    if (!zoneSession || zoneSession.choices.length === 0) {
      return false
    }

    updateZoneSession(zone.sessionId, (current) => ({
      ...current,
      choices: [],
    }))
    const toolScope = getToolScope()
    if (toolScope.projectId && toolScope.documentId) {
      void trpcClient.inline.clearSessionChoices
        .mutate({
          projectId: toolScope.projectId,
          documentId: toolScope.documentId,
          sessionId: zone.sessionId,
        })
        .catch((error) => {
          console.warn('Failed to clear inline session choices', error)
        })
    }
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
      pruneInlineOrphans()
      return
    }

    if (pluginState?.active) {
      const tr = view.state.tr.setMeta(aiWriterPluginKey, { type: 'accept' })
      tr.setMeta('addToHistory', false)
      view.dispatch(tr)
      pruneInlineOrphans()
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
        pruneInlineOrphans()
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
    pruneInlineOrphans()
  }

  function cancelAI(view?: EditorView): void {
    const targetView = view ?? currentView
    const activeZone =
      targetView && aiWriterPluginKey.getState(targetView.state)?.zoneId
        ? getTargetZone(
          targetView,
          aiWriterPluginKey.getState(targetView.state)?.zoneId ?? undefined
        )
        : null
    const toolScope = getToolScope()
    if (toolScope.projectId && toolScope.documentId && activeZone?.sessionId) {
      void trpcClient.inline.cancelGeneration
        .mutate({
          projectId: toolScope.projectId,
          documentId: toolScope.documentId,
          sessionId: activeZone.sessionId,
        })
        .catch(() => { })
    }

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

export type { AIWriterController } from './writer/types'
