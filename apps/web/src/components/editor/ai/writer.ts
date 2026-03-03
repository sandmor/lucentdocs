import { TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import type { UIMessage } from 'ai'
import { toast } from 'sonner'
import { aiWriterPluginKey, getAIZones } from './writer-plugin'
import type { InlineToolChip, InlineZoneSession } from '@plotline/shared'
import { StuckDetector } from './stuck-detector'
import {
  extractMessageTextFromPartsRaw,
  extractToolPartsFromParts,
  getMessageParts,
} from './message-parts'
import { getDocumentContext, getPromptContextForRange } from './writer/context'
import { createInlineSessionId, createZoneId } from './writer/ids'
import { createEmptySession } from './writer/session-state'
import { insertChunk, readErrorMessage } from './writer/stream'
import {
  createEmptyZoneSlice,
  createZoneNodeAttrs,
  deserializeOriginalSlice,
  getTargetZone,
  selectionOverlapsAIZone,
  unwrapZoneNodes,
  updateZoneNode,
  wrapSliceWithZoneNodes,
} from './writer/zone-marks'
import type {
  AIWriterController,
  AIWriterControllerOptions,
  PromptStreamPayload,
  StreamPayload,
} from './writer/types'
import { createUIMessageChunkPump } from './ui-message-chunk-pump'
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
  const getRequesterClientName = options.getRequesterClientName ?? (() => null)
  const getSessionById = options.getSessionById ?? (() => null)
  const setSessionById = options.setSessionById ?? (() => {})
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
      .catch(() => {})
  }

  const updateZoneSession = (
    sessionId: string,
    updater: (current: InlineZoneSession) => InlineZoneSession
  ) => {
    const currentSession = getSessionById(sessionId) ?? createEmptySession()
    setSessionById(sessionId, updater(currentSession))
  }

  const toToolChipState = (rawState: string): InlineToolChip['state'] =>
    rawState === 'output-available' ? 'complete' : 'pending'

  const extractInlineToolsFromMessage = (message: UIMessage): InlineToolChip[] => {
    const tools: InlineToolChip[] = []

    for (const part of extractToolPartsFromParts(getMessageParts(message))) {
      const partType = typeof part.type === 'string' ? part.type : ''
      const toolName =
        partType === 'dynamic-tool'
          ? typeof part.toolName === 'string'
            ? part.toolName
            : null
          : partType.startsWith('tool-')
            ? partType.replace(/^tool-/, '')
            : null
      if (!toolName) continue
      if (toolName === 'write_zone' || toolName === 'write_zone_choices') continue

      const rawState = typeof part.state === 'string' ? part.state : 'unknown'
      const nextState = toToolChipState(rawState)
      const existingIndex = tools.findIndex((tool) => tool.toolName === toolName)
      if (existingIndex >= 0) {
        tools[existingIndex] = {
          ...tools[existingIndex],
          state: nextState,
        }
      } else {
        tools.push({
          toolName,
          state: nextState,
        })
      }
    }

    return tools
  }

  const upsertAssistantMessageInSession = (
    session: InlineZoneSession,
    assistantMessage: UIMessage
  ): InlineZoneSession => {
    const assistantText = extractMessageTextFromPartsRaw(getMessageParts(assistantMessage))
    const assistantTools = extractInlineToolsFromMessage(assistantMessage)
    const messages = [...session.messages]
    const last = messages[messages.length - 1]
    const fallbackId = last?.role === 'assistant' ? last.id : `inline-assistant-${Date.now()}`
    const assistantId =
      typeof assistantMessage.id === 'string' && assistantMessage.id.trim()
        ? assistantMessage.id
        : fallbackId

    const assistant = {
      id: assistantId,
      role: 'assistant' as const,
      text: assistantText,
      tools: assistantTools,
    }

    if (last?.role === 'assistant') {
      messages[messages.length - 1] = assistant
    } else {
      messages.push(assistant)
    }

    return {
      ...session,
      messages,
    }
  }

  const getAssistantSeedMessage = (session: InlineZoneSession | null): UIMessage | null => {
    if (!session?.messages?.length) return null
    const latestAssistant = [...session.messages]
      .reverse()
      .find((message) => message.role === 'assistant')
    if (!latestAssistant) return null

    return {
      id: latestAssistant.id,
      role: 'assistant',
      parts: [{ type: 'text', text: latestAssistant.text }],
    }
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
          ? updateZoneNode(view, pluginState.zoneId, { streaming: false }, 'streaming_stop')
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
    sessionId: string
  ): Promise<void> {
    abortController?.abort()
    const requestAbortController = new AbortController()
    abortController = requestAbortController
    const requestId = ++currentRequestId
    currentView = view
    stuckDetector.reset()
    setStreamingState(true)

    let observeUnsubscribe: { unsubscribe: () => void } | null = null
    let activeGenerationId: string | null = null
    let lastInlineEventSeq = 0
    const chunkPump = createUIMessageChunkPump({
      isScopeActive: (scopeId) => scopeId === sessionId,
      onGeneratingChange: onStreamingChange ?? undefined,
      onMessage: (nextMessage) => {
        updateZoneSession(sessionId, (current) => upsertAssistantMessageInSession(current, nextMessage))
        stuckDetector.onChunk()
      },
      onError: (error) => {
        console.warn('Inline stream chunk pump failed', { error })
      },
    })

    try {
      const toolScope = getToolScope()
      if (!toolScope.projectId || !toolScope.documentId) {
        handleAIError(view, 'Inline AI streaming requires project and document scope')
        return
      }

      let resolveGenerationDone: (() => void) | null = null
      let rejectGenerationDone: ((error: Error) => void) | null = null

      const generationDone = new Promise<void>((resolve, reject) => {
        resolveGenerationDone = resolve
        rejectGenerationDone = reject
      })

      observeUnsubscribe = trpcClient.inline.observeSession.subscribe(
        {
          projectId: toolScope.projectId,
          documentId: toolScope.documentId,
          sessionId,
        },
        {
          onData: (event) => {
            if (requestAbortController.signal.aborted) return
            if (event.seq <= lastInlineEventSeq) return

            if (lastInlineEventSeq > 0 && event.seq > lastInlineEventSeq + 1) {
              rejectGenerationDone?.(
                new Error(
                  `Inline stream sequence gap detected (${lastInlineEventSeq} -> ${event.seq})`
                )
              )
              return
            }
            lastInlineEventSeq = event.seq

            if (event.type === 'stream-chunk') {
              if (!activeGenerationId || activeGenerationId !== event.generationId) {
                activeGenerationId = event.generationId
                const seed = getAssistantSeedMessage(getSessionById(sessionId))
                chunkPump.start(event.generationId, seed, sessionId)
              } else if (chunkPump.getGenerationId() !== event.generationId) {
                const seed = getAssistantSeedMessage(getSessionById(sessionId))
                chunkPump.start(event.generationId, seed, sessionId)
              }

              stuckDetector.onChunk()
              chunkPump.enqueue(event.chunk)
              return
            }

            if (!activeGenerationId && event.generating && event.generationId) {
              activeGenerationId = event.generationId
            }

            let nextSession = event.session ?? null
            if (event.generating && nextSession && activeGenerationId) {
              const localSession = getSessionById(sessionId)
              const hasLocalAssistant = Boolean(
                localSession?.messages.some((message) => message.role === 'assistant')
              )
              if (hasLocalAssistant) {
                nextSession = {
                  ...nextSession,
                  messages: [...localSession!.messages],
                }
              }
            }

            setSessionById(sessionId, nextSession)
            if (event.generating) {
              stuckDetector.onChunk()
            } else {
              chunkPump.stop()
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
            .catch(() => {})
        },
        { once: true }
      )

      const started = await trpcClient.inline.startPromptGeneration.mutate({
        projectId: toolScope.projectId,
        documentId: toolScope.documentId,
        sessionId,
        contextBefore: payload.contextBefore,
        contextAfter: payload.contextAfter,
        prompt: payload.prompt,
        selectedText: payload.selectedText,
        requesterClientName: getRequesterClientName() ?? undefined,
      })
      activeGenerationId = started.generationId

      await generationDone
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      const message = error instanceof Error ? error.message : 'AI streaming error'
      handleAIError(view, message)
    } finally {
      observeUnsubscribe?.unsubscribe()
      chunkPump.stop()

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

    if (isEmpty && pluginState?.active && pluginState.originalSlice) {
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

    const requestedPos = at_doc_end ? view.state.doc.content.size : view.state.selection.to
    const resolvedPos = Math.max(0, Math.min(requestedPos, view.state.doc.content.size))
    let pos = resolvedPos
    if (!view.state.doc.resolve(pos).parent.inlineContent) {
      let lastInlinePos: number | null = null
      view.state.doc.descendants((node, nodePos) => {
        if (node.isTextblock && node.inlineContent) {
          lastInlinePos = nodePos + node.nodeSize - 1
        }
        return true
      })

      if (lastInlinePos === null) {
        toast.error('AI continuation is only available inside text content')
        return
      }

      pos = lastInlinePos
    }
    const selection = view.state.selection
    if (!(selection.empty && selection.from === pos)) {
      const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos))
      tr.setMeta('addToHistory', false)
      view.dispatch(tr)
    }

    const zoneId = createZoneId()
    const zoneAttrs = createZoneNodeAttrs(zoneId, true, null, null)
    const zoneSlice = createEmptyZoneSlice(view, zoneAttrs)
    if (!zoneSlice) {
      toast.error('AI zones are not available in this editor schema')
      return
    }

    const tr = view.state.tr
    try {
      tr.replaceRange(pos, pos, zoneSlice)
    } catch {
      toast.error('Unable to insert AI zone at the current cursor position')
      return
    }
    const zoneStart = tr.mapping.map(pos, -1)
    tr.setMeta(aiWriterPluginKey, { type: 'start', pos: zoneStart, zoneId })
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
    if (from >= to) {
      return false
    }

    if (selectionOverlapsAIZone(view, from, to)) {
      toast.error('Selection overlaps an active AI zone. Select different text and try again.')
      return false
    }

    const selectedText = view.state.doc.textBetween(from, to, '\n\n', '\n')
    const originalSlice = view.state.doc.slice(from, to)
    const zoneId = createZoneId()
    const sessionId = createInlineSessionId()
    const { contextBefore, contextAfter } = getPromptContextForRange(
      view,
      from,
      to,
      getIncludeAfterContext()
    )

    const zoneSlice =
      originalSlice &&
      wrapSliceWithZoneNodes(
        view,
        originalSlice,
        createZoneNodeAttrs(zoneId, true, sessionId, JSON.stringify(originalSlice.toJSON()))
      )
    if (!zoneSlice) {
      toast.error('Unable to create AI zone for the current selection')
      return false
    }
    const tr = view.state.tr
    try {
      tr.replaceRange(from, to, zoneSlice)
    } catch {
      toast.error('Unable to create AI zone for the current selection')
      return false
    }
    const zoneStart = tr.mapping.map(from, -1)
    tr.setMeta(aiWriterPluginKey, {
      type: 'start',
      pos: zoneStart,
      zoneId,
      sessionId,
      originalSlice,
      originalFrom: from,
      selectionFrom: from,
      selectionTo: to,
    })
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
      sessionId
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
      pos: zone.nodeFrom,
      zoneId,
      sessionId,
      originalSlice: deserializeOriginalSlice(view, zone.originalSlice),
      originalFrom: zone.nodeFrom,
      selectionFrom: zone.nodeFrom,
      selectionTo: zone.nodeTo,
    })
    tr.setMeta('addToHistory', false)
    view.dispatch(tr)

    updateZoneNode(view, zoneId, {
      streaming: true,
      sessionId,
    })

    const selectedText = view.state.doc.textBetween(zone.nodeFrom, zone.nodeTo, '\n\n', '\n')
    const fallbackContext = getPromptContextForRange(
      view,
      zone.nodeFrom,
      zone.nodeTo,
      getIncludeAfterContext()
    )
    const zoneSession = zone.sessionId ? getSessionById(zone.sessionId) : null
    const contextBefore = zoneSession?.contextBefore ?? fallbackContext.contextBefore
    const contextAfter = zoneSession?.contextAfter ?? fallbackContext.contextAfter ?? null
    void streamAIPrompt(
      view,
      {
        mode: 'prompt',
        contextBefore,
        contextAfter: contextAfter ?? undefined,
        prompt: trimmedPrompt,
        selectedText,
        selectionFrom: zone.nodeFrom,
        selectionTo: zone.nodeTo,
      },
      sessionId
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
      unwrapZoneNodes(view, zone.id, { metaType: 'accept', addToHistory: true })
      pruneInlineOrphans()
      return
    }

    if (pluginState?.active) {
      const tr = view.state.tr.setMeta(aiWriterPluginKey, { type: 'accept' })
      tr.setMeta('addToHistory', true)
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
        const tr = view.state.tr.setMeta(aiWriterPluginKey, { type: 'reject' })
        tr.setMeta('addToHistory', false)
        view.dispatch(tr)
        pruneInlineOrphans()
      }
      return
    }

    const tr = view.state.tr
    const originalSlice =
      deserializeOriginalSlice(view, zone.originalSlice) ??
      (pluginState?.zoneId === zone.id ? pluginState.originalSlice : null)

    tr.delete(zone.nodeFrom, zone.nodeTo)
    if (originalSlice) {
      tr.replace(zone.nodeFrom, zone.nodeFrom, originalSlice)
    }

    tr.setMeta(aiWriterPluginKey, { type: 'reject' })
    tr.setMeta('addToHistory', true)
    view.dispatch(tr)
    pruneInlineOrphans()
  }

  function cancelAI(view?: EditorView, options: { preserveDoc?: boolean } = {}): void {
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
        .catch(() => {})
    }

    abortController?.abort()
    abortController = null
    streamedText = ''
    stuckDetector.reset()
    currentView = null
    if (options.preserveDoc && view) {
      onStreamingChange?.(false)
      const tr = view.state.tr.setMeta(aiWriterPluginKey, { type: 'streaming_stop' })
      tr.setMeta('addToHistory', false)
      view.dispatch(tr)
    } else if (options.preserveDoc) {
      setStreamingState(false)
    } else if (view) {
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
