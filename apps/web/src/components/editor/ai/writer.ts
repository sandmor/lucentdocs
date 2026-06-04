import { TextSelection } from 'prosemirror-state'
import { closeHistory } from 'prosemirror-history'
import { EditorView } from 'prosemirror-view'
import { toast } from 'sonner'
import { aiWriterPluginKey, getAIZones } from './writer-plugin'
import { type InlineZoneSession } from '@lucentdocs/shared'
import { StuckDetector } from './stuck-detector'
import { createInlineSessionId, createZoneId } from './writer/ids'
import { createEmptySession } from './writer/session-state'
import { waitForInlineGeneration } from '../inline/inline-generation-wait'
import {
  emitInlineStreamActivity,
  registerInlineStreamActivityHandler,
} from '../inline/inline-stream-activity'
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
import type { AIWriterController, AIWriterControllerOptions, InlineStreamPayload } from './writer/types'
import { getTrpcProxyClient } from '@/lib/trpc'

export function createAIWriterController(
  options: AIWriterControllerOptions = {}
): AIWriterController {
  let abortController: AbortController | null = null
  let currentRequestId = 0
  const abortPolicies = new WeakMap<AbortController, { cancelServerOnAbort: boolean }>()
  const onStreamingChange = options.onStreamingChange ?? null
  const getToolScope =
    options.getToolScope ??
    (() => ({
      projectId: undefined,
      documentId: undefined,
    }))
  const getRequesterClientName = options.getRequesterClientName ?? (() => null)
  const getSessionById = options.getSessionById ?? (() => null)
  const setSessionById = options.setSessionById ?? (() => {})
  const bubblePresence = options.bubblePresence ?? null
  let currentView: EditorView | null = null
  const trpcClient = getTrpcProxyClient()

  const setAbortPolicy = (
    controller: AbortController,
    policy: { cancelServerOnAbort: boolean }
  ): void => {
    abortPolicies.set(controller, policy)
  }

  const abortActiveRequest = (policy: { cancelServerOnAbort: boolean }): void => {
    const activeController = abortController
    if (!activeController) return
    setAbortPolicy(activeController, policy)
    activeController.abort()
  }

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

  const clearBubblePresence = (sessionId: string): void => {
    bubblePresence?.clear(sessionId)
  }

  const clearBubblePresenceForView = (view?: EditorView | null): void => {
    const targetView = view ?? currentView
    if (!targetView) return
    const pluginState = aiWriterPluginKey.getState(targetView.state)
    if (!pluginState?.sessionId) return
    clearBubblePresence(pluginState.sessionId)
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

  async function streamAIPrompt(
    view: EditorView,
    payload: InlineStreamPayload,
    sessionId: string
  ): Promise<void> {
    abortActiveRequest({ cancelServerOnAbort: true })
    const requestAbortController = new AbortController()
    abortController = requestAbortController
    setAbortPolicy(requestAbortController, { cancelServerOnAbort: true })
    const requestId = ++currentRequestId
    currentView = view
    stuckDetector.reset()
    setStreamingState(true)

    const unregisterStreamActivity = registerInlineStreamActivityHandler((activeSessionId) => {
      if (activeSessionId !== sessionId) return
      stuckDetector.onChunk()
    })

    try {
      const toolScope = getToolScope()
      if (!toolScope.projectId || !toolScope.documentId) {
        handleAIError(view, 'Inline AI streaming requires project and document scope')
        return
      }

      let activeGenerationId: string | null = null
      let cancelRequested = false

      const requestServerCancel = (generationId: string) => {
        void trpcClient.inline.cancelGeneration
          .mutate({
            projectId: toolScope.projectId!,
            documentId: toolScope.documentId!,
            sessionId,
            generationId,
          })
          .catch(() => {})
      }

      requestAbortController.signal.addEventListener(
        'abort',
        () => {
          const abortPolicy = abortPolicies.get(requestAbortController)
          abortPolicies.delete(requestAbortController)
          const shouldCancelServer = abortPolicy?.cancelServerOnAbort ?? true

          if (shouldCancelServer && activeGenerationId) {
            cancelRequested = true
            requestServerCancel(activeGenerationId)
          }
        },
        { once: true }
      )

      const started =
        payload.mode === 'prompt'
          ? await trpcClient.inline.startPromptGeneration.mutate({
              projectId: toolScope.projectId,
              documentId: toolScope.documentId,
              sessionId,
              prompt: payload.prompt,
              selectionFrom: payload.selectionFrom,
              selectionTo: payload.selectionTo,
              requesterClientName: getRequesterClientName() ?? undefined,
            })
          : await trpcClient.inline.startContinuationGeneration.mutate({
              projectId: toolScope.projectId,
              documentId: toolScope.documentId,
              sessionId,
              selectionFrom: payload.selectionFrom,
              selectionTo: payload.selectionTo,
              requesterClientName: getRequesterClientName() ?? undefined,
            })

      activeGenerationId = started.generationId
      emitInlineStreamActivity(sessionId)

      if (cancelRequested) {
        requestServerCancel(started.generationId)
      }

      await waitForInlineGeneration(sessionId, started.generationId, requestAbortController.signal)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      const message = error instanceof Error ? error.message : 'AI streaming error'
      handleAIError(view, message)
    } finally {
      unregisterStreamActivity()
      clearBubblePresence(sessionId)

      if (requestId === currentRequestId && abortController === requestAbortController) {
        abortController = null
        setStreamingState(false, view)
      }
    }
  }

  function handleAIError(view: EditorView, message: string): void {
    toast.error('AI generation failed', { description: message })
    clearBubblePresenceForView(view)

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
    clearBubblePresenceForView(view)
    setStreamingState(false)
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
    const sessionId = createInlineSessionId()
    const zoneAttrs = createZoneNodeAttrs(zoneId, true, sessionId, null)
    const zoneSlice = createEmptyZoneSlice(view, zoneAttrs)
    if (!zoneSlice) {
      toast.error('AI zones are not available in this editor schema')
      return
    }

    const closeHistoryTr = closeHistory(view.state.tr)
    closeHistoryTr.setMeta('addToHistory', false)
    view.dispatch(closeHistoryTr)

    const tr = view.state.tr
    try {
      tr.replaceRange(pos, pos, zoneSlice)
    } catch {
      toast.error('Unable to insert AI zone at the current cursor position')
      return
    }
    const zoneStart = tr.mapping.map(pos, -1)
    tr.setMeta(aiWriterPluginKey, { type: 'start', pos: zoneStart, zoneId, sessionId })
    tr.setMeta('addToHistory', true)
    view.dispatch(tr)

    void streamAIPrompt(
      view,
      {
        mode: 'continue',
        selectionFrom: pos,
        selectionTo: pos,
      },
      sessionId
    )
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

    const originalSlice = view.state.doc.slice(from, to)
    const zoneId = createZoneId()
    const sessionId = createInlineSessionId()

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

    const closeHistoryTr = closeHistory(view.state.tr)
    closeHistoryTr.setMeta('addToHistory', false)
    view.dispatch(closeHistoryTr)

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

    void streamAIPrompt(
      view,
      {
        mode: 'prompt',
        prompt: trimmedPrompt,
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
    if (!zone.sessionId) {
      toast.error('This AI zone has no conversation history. Accept or reject it and try again.')
      return false
    }
    const sessionId = zone.sessionId

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
    void streamAIPrompt(
      view,
      {
        mode: 'prompt',
        prompt: trimmedPrompt,
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

    abortActiveRequest({ cancelServerOnAbort: true })
    abortController = null
    stuckDetector.reset()
    currentView = null
    if (pluginState?.sessionId) {
      clearBubblePresence(pluginState.sessionId)
    }
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

    abortActiveRequest({ cancelServerOnAbort: true })
    abortController = null
    stuckDetector.reset()
    currentView = null
    if (pluginState?.sessionId) {
      clearBubblePresence(pluginState.sessionId)
    }
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

  function cancelAI(
    view?: EditorView,
    options: { preserveDoc?: boolean; zoneId?: string } = {}
  ): void {
    const targetView = view ?? currentView
    const targetPluginState = targetView ? aiWriterPluginKey.getState(targetView.state) : null
    const preferredZoneId = options.zoneId ?? targetPluginState?.zoneId
    const activeZone = targetView ? getTargetZone(targetView, preferredZoneId ?? undefined) : null
    const hasActiveLocalRequest = Boolean(abortController)
    if (!hasActiveLocalRequest) {
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
    }

    abortActiveRequest({ cancelServerOnAbort: true })
    abortController = null
    stuckDetector.reset()
    clearBubblePresenceForView(targetView)
    currentView = null
    if (options.preserveDoc && targetView) {
      onStreamingChange?.(false)
      const stoppedZoneId = activeZone?.id ?? preferredZoneId ?? undefined
      const updated = stoppedZoneId
        ? updateZoneNode(targetView, stoppedZoneId, { streaming: false }, 'streaming_stop')
        : false
      if (!updated) {
        const tr = targetView.state.tr.setMeta(aiWriterPluginKey, { type: 'streaming_stop' })
        tr.setMeta('addToHistory', false)
        targetView.dispatch(tr)
      }
    } else if (options.preserveDoc) {
      setStreamingState(false)
    } else if (targetView) {
      setStreamingState(false, targetView)
    } else {
      setStreamingState(false)
    }
  }

  /**
   * Tears down local streaming observers while allowing the server-side run to continue.
   *
   * This prevents unmounted views from receiving stream updates while preserving
   * the in-flight generation for reconnecting clients.
   */
  function detachAI(): void {
    abortActiveRequest({ cancelServerOnAbort: false })
    abortController = null

    stuckDetector.reset()
    clearBubblePresenceForView(currentView)
    currentView = null
    onStreamingChange?.(false)
  }

  return {
    startAIContinuation,
    startAIPromptAtRange,
    continueAIPromptForZone,
    dismissChoicesForZone,
    acceptAI,
    rejectAI,
    cancelAI,
    detachAI,
  }
}

export type { AIWriterController } from './writer/types'
