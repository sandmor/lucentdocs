import { observable } from '@trpc/server/observable'
import { nanoid } from 'nanoid'
import { readUIMessageStream, stepCountIs, streamText, type UIMessage, type UIMessageChunk } from 'ai'
import type {
  InlineChatMessage,
  InlineToolChip,
  InlineZoneSession,
  InlineZoneWriteAction,
} from '@plotline/shared'
import type { ServiceSet } from '../core/services/types.js'
import { getLanguageModel } from '../ai/index.js'
import { assertPromptProtocolMode, resolveSelectionPrompt } from '../ai/prompt-engine.js'
import { configManager } from '../config/manager.js'
import { buildInlineZoneWriteTools, buildReadTools, hasValidToolScope } from '../chat/tools.js'
import {
  createInlineSessionMetadataStore,
  type InlineScope,
  type InlineSessionMetadataStore,
} from './metadata-store.js'
import type { RepositorySet } from '../core/ports/types.js'
import type { YjsRuntime } from '../yjs/runtime.js'
import { applyInlineZoneWriteActionToDoc } from './zone-write.js'

export interface InlineObserveState extends InlineScope {
  sessionId: string
  seq: number
  deleted: boolean
  generating: boolean
  generationId: string | null
  session: InlineZoneSession | null
}

export interface InlineObserveChunkEvent extends InlineScope {
  type: 'stream-chunk'
  projectId: string
  documentId: string
  sessionId: string
  generationId: string
  seq: number
  chunk: UIMessageChunk
}

export interface InlineObserveSnapshotEvent extends InlineObserveState {
  type: 'snapshot'
}

export type InlineObserveEvent = InlineObserveSnapshotEvent | InlineObserveChunkEvent

export interface StartInlineGenerationInput extends InlineScope {
  sessionId: string
  contextBefore: string
  contextAfter?: string
  prompt: string
  selectedText?: string
  maxOutputTokens?: number
  requesterClientName?: string
}

interface ActiveGeneration {
  id: string
  controller: AbortController
  events: InlineObserveEvent[]
}

interface ParsedInlineToolPart {
  toolName: string
  rawState: string
  chipState: 'pending' | 'complete'
}

function isTestRuntime(): boolean {
  return (
    configManager.getConfig().runtime.nodeEnv === 'test' || process.env.PLOTLINE_TEST_MODE === '1'
  )
}

function resolveTestInlineResponse(prompt: string): string {
  const envOverride = process.env.PLOTLINE_TEST_INLINE_RESPONSE?.trim()
  if (envOverride) return envOverride

  const normalizedPrompt = prompt.trim().toLowerCase()
  if (normalizedPrompt.includes('mobile')) return 'mobile'
  return 'spark'
}

function toInlineKey(scope: InlineScope & { sessionId: string }): string {
  return `${scope.projectId}:${scope.documentId}:${scope.sessionId}`
}

function createObserveState(
  scope: InlineScope & { sessionId: string },
  options: {
    seq: number
    session: InlineZoneSession | null
    generating: boolean
    generationId: string | null
  }
): InlineObserveState {
  return {
    projectId: scope.projectId,
    documentId: scope.documentId,
    sessionId: scope.sessionId,
    seq: options.seq,
    deleted: options.session === null,
    generating: options.generating,
    generationId: options.generationId,
    session: options.session,
  }
}

function createEmptySession(): InlineZoneSession {
  return {
    messages: [],
    choices: [],
    contextBefore: null,
    contextAfter: null,
  }
}

function createInlineMessageId(role: 'user' | 'assistant'): string {
  return `inline-${role}-${nanoid()}`
}

function createUserMessage(text: string): InlineChatMessage {
  return {
    id: createInlineMessageId('user'),
    role: 'user',
    text,
    tools: [],
  }
}

function serializeInlineConversation(session: InlineZoneSession): string {
  if (session.messages.length === 0) {
    return ''
  }

  return session.messages
    .map((message) => {
      const role = message.role === 'assistant' ? 'Assistant' : 'User'
      const text = message.text.trim()
      if (!text) return ''
      return `${role}: ${text}`
    })
    .filter((line) => line.length > 0)
    .join('\n')
}

function getMessageParts(message: unknown): unknown[] {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return []
  }

  const record = message as Record<string, unknown>
  return Array.isArray(record.parts) ? record.parts : []
}

function extractMessageTextFromPartsRaw(parts: unknown[]): string {
  return parts
    .flatMap((part) => {
      if (typeof part !== 'object' || part === null || Array.isArray(part)) return []
      const record = part as Record<string, unknown>
      if (record.type !== 'text') return []
      return typeof record.text === 'string' ? [record.text] : []
    })
    .join('')
}

function extractToolPartsFromParts(parts: unknown[]): Record<string, unknown>[] {
  return parts.flatMap((part) => {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) return []
    const record = part as Record<string, unknown>
    if (typeof record.type !== 'string') return []
    if (record.type === 'dynamic-tool' || record.type.startsWith('tool-')) return [record]
    return []
  })
}

function parseInlineToolPart(part: Record<string, unknown>): ParsedInlineToolPart | null {
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
  const chipState: 'pending' | 'complete' = rawState === 'output-available' ? 'complete' : 'pending'

  return {
    toolName,
    rawState,
    chipState,
  }
}

function extractAssistantTools(parts: unknown[]): InlineToolChip[] {
  const tools: InlineToolChip[] = []

  for (const part of extractToolPartsFromParts(parts)) {
    const parsed = parseInlineToolPart(part)
    if (!parsed) continue
    if (parsed.toolName === 'write_zone' || parsed.toolName === 'write_zone_choices') continue

    const existingIndex = tools.findIndex((tool) => tool.toolName === parsed.toolName)
    if (existingIndex >= 0) {
      tools[existingIndex] = {
        ...tools[existingIndex],
        state: parsed.chipState,
      }
    } else {
      tools.push({
        toolName: parsed.toolName,
        state: parsed.chipState,
      })
    }
  }

  return tools
}

function upsertAssistantMessage(session: InlineZoneSession, message: UIMessage): InlineZoneSession {
  const parts = getMessageParts(message)
  const assistantText = extractMessageTextFromPartsRaw(parts)
  const tools = extractAssistantTools(parts)

  const messages = [...session.messages]
  const last = messages[messages.length - 1]
  const fallbackId = last?.role === 'assistant' ? last.id : createInlineMessageId('assistant')
  const assistantId =
    typeof message.id === 'string' && message.id.trim().length > 0 ? message.id : fallbackId

  const assistant: InlineChatMessage = {
    id: assistantId,
    role: 'assistant',
    text: assistantText,
    tools,
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

function applyWriteActionToSession(
  session: InlineZoneSession,
  action: InlineZoneWriteAction
): InlineZoneSession {
  if (action.type !== 'set_choices') {
    return session
  }

  const nextChoices = action.choices
  if (nextChoices === session.choices) {
    return session
  }

  return {
    ...session,
    choices: [...nextChoices],
  }
}

function normalizeRequesterClientName(name: string | undefined): string {
  const trimmed = name?.trim() ?? ''
  if (!trimmed) return 'inline-client'

  const safe = trimmed.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)
  return safe.length > 0 ? safe : 'inline-client'
}

function toInlineServerOrigin(requesterClientName: string): string {
  const normalized = normalizeRequesterClientName(requesterClientName)
  return `${normalized}__inline_server`
}

export class InlineRuntimeError extends Error {
  readonly code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT'

  constructor(code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT', message: string) {
    super(message)
    this.name = 'InlineRuntimeError'
    this.code = code
  }
}

type InlineListener = (event: InlineObserveEvent) => void

export class InlineRuntime {
  #services: ServiceSet
  #store: InlineSessionMetadataStore
  #yjsRuntime: YjsRuntime
  #listeners = new Map<string, Set<InlineListener>>()
  #liveStates = new Map<string, InlineObserveSnapshotEvent>()
  #activeGenerations = new Map<string, ActiveGeneration>()
  #activePrunes = new Map<string, Promise<void>>()
  #sessionWriteTasks = new Map<string, Promise<void>>()
  #eventSeqByKey = new Map<string, number>()

  constructor(
    services: ServiceSet,
    repos: Pick<RepositorySet, 'documents' | 'projectDocuments' | 'yjsDocuments'>,
    yjsRuntime: YjsRuntime
  ) {
    this.#services = services
    this.#store = createInlineSessionMetadataStore(repos)
    this.#yjsRuntime = yjsRuntime
  }

  #shouldRetainState(key: string): boolean {
    return this.#activeGenerations.has(key) || (this.#listeners.get(key)?.size ?? 0) > 0
  }

  #nextSeq(key: string): number {
    const nextSeq = (this.#eventSeqByKey.get(key) ?? 0) + 1
    this.#eventSeqByKey.set(key, nextSeq)
    return nextSeq
  }

  #toSnapshotEvent(state: InlineObserveState): InlineObserveSnapshotEvent {
    return {
      ...state,
      type: 'snapshot',
    }
  }

  #cacheSnapshot(snapshot: InlineObserveSnapshotEvent): void {
    const key = toInlineKey(snapshot)
    if (this.#shouldRetainState(key)) {
      this.#liveStates.set(key, snapshot)
    } else {
      this.#liveStates.delete(key)
      this.#eventSeqByKey.delete(key)
    }
  }

  #emitEvent(event: InlineObserveEvent): void {
    if (event.type === 'snapshot') {
      this.#cacheSnapshot(event)
    }

    const key = toInlineKey(event)
    const listeners = this.#listeners.get(key)
    if (!listeners) return

    for (const listener of listeners) {
      try {
        listener(event)
      } catch (error) {
        console.error('Inline observe listener failed', error)
      }
    }
  }

  #emitStreamChunk(
    scope: InlineScope & { sessionId: string },
    generationId: string,
    chunk: UIMessageChunk
  ): void {
    const key = toInlineKey(scope)
    const event: InlineObserveChunkEvent = {
      type: 'stream-chunk',
      projectId: scope.projectId,
      documentId: scope.documentId,
      sessionId: scope.sessionId,
      generationId,
      seq: this.#nextSeq(key),
      chunk,
    }

    const active = this.#activeGenerations.get(key)
    if (active?.id === generationId) {
      active.events.push(event)
    }

    this.#emitEvent(event)
  }

  async getSessions(
    scope: InlineScope,
    sessionIds: readonly string[]
  ): Promise<Record<string, InlineZoneSession>> {
    const sessions = await this.#store.getSessions(scope, sessionIds)
    if (!sessions) {
      throw new InlineRuntimeError(
        'NOT_FOUND',
        `Document ${scope.documentId} not found in project ${scope.projectId}`
      )
    }

    return sessions
  }

  async pruneOrphanSessions(scope: InlineScope): Promise<void> {
    const pruneKey = `${scope.projectId}:${scope.documentId}`
    const inFlight = this.#activePrunes.get(pruneKey)
    if (inFlight) {
      await inFlight
      return
    }

    const task = (async () => {
      const pruned = await this.#store.pruneOrphans(scope)
      if (!pruned) return
      if (pruned.removedSessionIds.length === 0) return

      for (const sessionId of pruned.removedSessionIds) {
        const state = await this.#loadPersistedState({ ...scope, sessionId })
        this.#emitSnapshot(state)
      }
    })()

    this.#activePrunes.set(pruneKey, task)
    try {
      await task
    } finally {
      this.#activePrunes.delete(pruneKey)
    }
  }

  async subscribe(
    scope: InlineScope & { sessionId: string },
    listener: InlineListener
  ): Promise<() => void> {
    const key = toInlineKey(scope)
    let listeners = this.#listeners.get(key)
    if (!listeners) {
      listeners = new Set<InlineListener>()
      this.#listeners.set(key, listeners)
    }

    let initializing = true
    const queuedEvents: InlineObserveEvent[] = []
    const queuedEventSeq = new Set<number>()

    const wrappedListener: InlineListener = (event) => {
      if (initializing) {
        if (queuedEventSeq.has(event.seq)) return
        queuedEventSeq.add(event.seq)
        queuedEvents.push(event)
        return
      }
      listener(event)
    }

    listeners.add(wrappedListener)

    try {
      let lastDeliveredSeq = 0
      const activeGeneration = this.#activeGenerations.get(key)
      if (activeGeneration && activeGeneration.events.length > 0) {
        const baselineSnapshot = activeGeneration.events.find((event) => event.type === 'snapshot')
        if (baselineSnapshot) {
          listener(baselineSnapshot)
          lastDeliveredSeq = baselineSnapshot.seq
        }
        for (const event of activeGeneration.events) {
          if (event.seq <= lastDeliveredSeq) continue
          listener(event)
          lastDeliveredSeq = event.seq
        }
      } else {
        const cachedState = this.#liveStates.get(key)
        if (cachedState) {
          listener(cachedState)
          lastDeliveredSeq = cachedState.seq
        } else {
          const state = await this.#loadPersistedState(scope)
          const snapshot = this.#toSnapshotEvent(state)
          this.#cacheSnapshot(snapshot)
          listener(snapshot)
          lastDeliveredSeq = snapshot.seq
        }
      }

      initializing = false
      for (const event of queuedEvents) {
        if (event.seq <= lastDeliveredSeq) continue
        listener(event)
        lastDeliveredSeq = event.seq
      }
    } catch (error) {
      listeners.delete(wrappedListener)
      if (listeners.size === 0) {
        this.#listeners.delete(key)
      }
      throw error
    }

    return () => {
      const current = this.#listeners.get(key)
      if (!current) return

      current.delete(wrappedListener)
      if (current.size === 0) {
        this.#listeners.delete(key)
        if (!this.#activeGenerations.has(key)) {
          this.#liveStates.delete(key)
          this.#eventSeqByKey.delete(key)
        }
      }
    }
  }

  isGenerating(scope: InlineScope & { sessionId: string }): boolean {
    return this.#activeGenerations.has(toInlineKey(scope))
  }

  cancelGeneration(scope: InlineScope & { sessionId: string }): boolean {
    const key = toInlineKey(scope)
    const active = this.#activeGenerations.get(key)
    if (!active) return false

    active.controller.abort()
    return true
  }

  async startGeneration(input: StartInlineGenerationInput): Promise<{ generationId: string }> {
    const key = toInlineKey(input)
    if (this.#activeGenerations.has(key)) {
      throw new InlineRuntimeError('CONFLICT', 'Inline generation is already in progress.')
    }

    const prompt = input.prompt.trim()
    const maxPromptChars = configManager.getConfig().limits.promptChars
    if (!prompt || prompt.length > maxPromptChars) {
      throw new InlineRuntimeError(
        'BAD_REQUEST',
        `Prompt must be between 1 and ${maxPromptChars} characters`
      )
    }

    const documentExists = await this.#store.isDocumentInScope(input)
    if (!documentExists) {
      throw new InlineRuntimeError(
        'NOT_FOUND',
        `Document ${input.documentId} not found in project ${input.projectId}`
      )
    }

    const persistedSession = await this.#store.getSession(input, input.sessionId)
    if (persistedSession === undefined) {
      throw new InlineRuntimeError(
        'NOT_FOUND',
        `Document ${input.documentId} not found in project ${input.projectId}`
      )
    }

    const baseSession = persistedSession ?? createEmptySession()
    const sessionWithUserMessage: InlineZoneSession = {
      ...baseSession,
      contextBefore: baseSession.contextBefore ?? input.contextBefore,
      contextAfter: baseSession.contextAfter ?? input.contextAfter ?? null,
      messages: [...baseSession.messages, createUserMessage(prompt)],
    }

    const userMessageSaved = await this.#store.saveSession(
      input,
      input.sessionId,
      sessionWithUserMessage
    )
    if (!userMessageSaved) {
      throw new InlineRuntimeError(
        'NOT_FOUND',
        `Document ${input.documentId} not found in project ${input.projectId}`
      )
    }

    const generationId = nanoid()
    const controller = new AbortController()
    const requesterClientName = normalizeRequesterClientName(input.requesterClientName)
    const startedState = createObserveState(input, {
      seq: this.#nextSeq(key),
      session: sessionWithUserMessage,
      generating: true,
      generationId,
    })
    const startedSnapshot = this.#toSnapshotEvent(startedState)
    this.#activeGenerations.set(key, {
      id: generationId,
      controller,
      events: [startedSnapshot],
    })
    this.#emitEvent(startedSnapshot)

    void this.#runGeneration(
      input,
      generationId,
      controller,
      sessionWithUserMessage,
      prompt,
      requesterClientName
    )

    return { generationId }
  }

  observe(
    scope: InlineScope & { sessionId: string },
    signal?: AbortSignal
  ): ReturnType<typeof observable<InlineObserveEvent>> {
    return observable<InlineObserveEvent>((emit) => {
      let closed = false
      let unsubscribe: (() => void) | null = null

      void this.subscribe(scope, (event) => {
        emit.next(event)
      })
        .then((nextUnsubscribe) => {
          if (closed) {
            nextUnsubscribe()
            return
          }
          unsubscribe = nextUnsubscribe
        })
        .catch((error) => {
          emit.error(error)
        })

      const onAbort = () => {
        closed = true
        unsubscribe?.()
      }

      signal?.addEventListener('abort', onAbort)

      return () => {
        closed = true
        signal?.removeEventListener('abort', onAbort)
        unsubscribe?.()
      }
    })
  }

  async #applyWriteActionToDocument(
    scope: InlineScope & { sessionId: string },
    action: InlineZoneWriteAction,
    requesterClientName: string
  ): Promise<void> {
    if (action.type === 'set_choices') {
      return
    }

    const documentInScope = await this.#store.isDocumentInScope(scope)
    if (!documentInScope) {
      throw new InlineRuntimeError(
        'NOT_FOUND',
        `Document ${scope.documentId} not found in project ${scope.projectId}`
      )
    }

    const transformed = await this.#yjsRuntime.applyProsemirrorTransform(scope.documentId, {
      origin: toInlineServerOrigin(requesterClientName),
      transform: (currentDoc) => {
        const applied = applyInlineZoneWriteActionToDoc(currentDoc, scope.sessionId, action)
        return {
          changed: applied.changed,
          nextDoc: applied.nextDoc,
          result: applied,
        }
      },
    })
    const applied = transformed.result

    if (!applied.zoneFound) {
      throw new InlineRuntimeError(
        'NOT_FOUND',
        `AI zone for inline session ${scope.sessionId} was not found in document ${scope.documentId}`
      )
    }
  }

  async #enqueueSessionWrite(
    scope: InlineScope & { sessionId: string },
    task: () => Promise<void>
  ): Promise<void> {
    const key = toInlineKey(scope)
    const previous = this.#sessionWriteTasks.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(task)
    this.#sessionWriteTasks.set(key, next)
    try {
      await next
    } finally {
      if (this.#sessionWriteTasks.get(key) === next) {
        this.#sessionWriteTasks.delete(key)
      }
    }
  }

  async #runGeneration(
    input: StartInlineGenerationInput,
    generationId: string,
    controller: AbortController,
    baseSession: InlineZoneSession,
    prompt: string,
    requesterClientName: string
  ): Promise<void> {
    const key = toInlineKey(input)
    let finalSession = baseSession

    try {
      if (isTestRuntime()) {
        finalSession = await this.#runTestGeneration(input, generationId, controller, baseSession)
        return
      }

      const rendered = resolveSelectionPrompt(
        baseSession.contextBefore ?? input.contextBefore,
        baseSession.contextAfter ?? input.contextAfter ?? null,
        prompt,
        input.selectedText ?? null,
        serializeInlineConversation(baseSession)
      )
      assertPromptProtocolMode(rendered.definition, 'prompt')

      const writeTools = buildInlineZoneWriteTools({
        onWriteAction: async (action) => {
          await this.#enqueueSessionWrite(input, async () => {
            await this.#applyWriteActionToDocument(input, action, requesterClientName)
            const nextSession = applyWriteActionToSession(finalSession, action)
            if (nextSession === finalSession) return

            finalSession = nextSession
            const active = this.#activeGenerations.get(key)
            const seq = this.#nextSeq(key)
            this.#emitSnapshot(
              createObserveState(input, {
                seq,
                session: finalSession,
                generating: true,
                generationId,
              }),
              {
                recordInGeneration: active?.id === generationId ? generationId : null,
              }
            )
          })
        },
      })

      const readTools = hasValidToolScope(input)
        ? buildReadTools({
            scope: {
              projectId: input.projectId,
              documentId: input.documentId,
            },
            services: this.#services,
          })
        : {}

      const tools = {
        ...readTools,
        ...writeTools,
      }

      const model = await getLanguageModel()
      const runtimeLimits = configManager.getConfig().limits
      const result = streamText({
        model,
        system: rendered.systemPrompt,
        prompt: rendered.userPrompt,
        tools,
        stopWhen: stepCountIs(runtimeLimits.aiToolSteps),
        maxOutputTokens: input.maxOutputTokens ?? rendered.definition.defaults.maxOutputTokens,
        temperature: rendered.definition.defaults.temperature,
        abortSignal: controller.signal,
      })

      const uiStream = result.toUIMessageStream({
        onError: (error) => {
          console.error('AI inline prompt stream error', error)
          return error instanceof Error ? error.message : 'Inline AI stream failed'
        },
      })

      const [chunkStream, messageStream] = uiStream.tee()
      let chunkReader: ReadableStreamDefaultReader<UIMessageChunk> | null = chunkStream.getReader()
      const chunkForwardTask = (async () => {
        const reader = chunkReader
        if (!reader) return
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            this.#emitStreamChunk(input, generationId, value)
          }
        } catch (error) {
          if (!(error instanceof Error && error.name === 'AbortError') && !controller.signal.aborted) {
            console.error('Inline UI chunk forwarding failed', error)
          }
        } finally {
          reader.releaseLock()
        }
      })()

      let latestAssistant: UIMessage | null = null
      for await (const assistantMessage of readUIMessageStream<UIMessage>({
        message: latestAssistant ?? undefined,
        stream: messageStream,
        terminateOnError: false,
        onError: (error) => {
          console.warn('Failed to read inline AI UI message stream', { error })
        },
      })) {
        latestAssistant = assistantMessage
        finalSession = upsertAssistantMessage(finalSession, assistantMessage)
      }

      if (chunkReader) {
        try {
          await chunkReader.cancel()
        } catch {
          // Ignore cancellation errors when stream already closed.
        }
      }
      chunkReader = null
      await chunkForwardTask
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        console.error('Inline prompt generation failed', error)
      }
    } finally {
      const active = this.#activeGenerations.get(key)
      if (active?.id === generationId) {
        this.#activeGenerations.delete(key)
      }

      let sessionForSnapshot: InlineZoneSession | null = finalSession
      try {
        const saved = await this.#store.saveSession(input, input.sessionId, finalSession)
        if (!saved) {
          const persisted = await this.#store.getSession(input, input.sessionId)
          if (persisted === undefined) {
            console.warn(
              `Inline session ${input.sessionId} is no longer available for ${input.projectId}/${input.documentId}`
            )
            sessionForSnapshot = null
          } else {
            sessionForSnapshot = persisted
          }
        }
      } catch (error) {
        console.error('Failed to persist inline session state', error)
      }

      this.#emitSnapshot(
        createObserveState(input, {
          seq: this.#nextSeq(key),
          session: sessionForSnapshot,
          generating: false,
          generationId: null,
        })
      )
    }
  }

  async #runTestGeneration(
    input: StartInlineGenerationInput,
    generationId: string,
    controller: AbortController,
    baseSession: InlineZoneSession
  ): Promise<InlineZoneSession> {
    if (controller.signal.aborted) return baseSession

    const messageId = `test-inline-${generationId}`
    const generated = resolveTestInlineResponse(input.prompt)

    const assistantMessage: InlineChatMessage = {
      id: messageId,
      role: 'assistant',
      text: generated,
      tools: [],
    }

    return {
      ...baseSession,
      messages: [...baseSession.messages, assistantMessage],
    }
  }

  async #loadPersistedState(
    scope: InlineScope & { sessionId: string }
  ): Promise<InlineObserveState> {
    const session = await this.#store.getSession(scope, scope.sessionId)
    if (session === undefined) {
      throw new InlineRuntimeError(
        'NOT_FOUND',
        `Document ${scope.documentId} not found in project ${scope.projectId}`
      )
    }

    const activeGeneration = this.#activeGenerations.get(toInlineKey(scope))
    return createObserveState(scope, {
      seq: this.#nextSeq(toInlineKey(scope)),
      session,
      generating: Boolean(activeGeneration),
      generationId: activeGeneration?.id ?? null,
    })
  }

  #emitSnapshot(
    state: InlineObserveState,
    options: { recordInGeneration?: string | null } = {}
  ): void {
    const snapshot = this.#toSnapshotEvent(state)
    const key = toInlineKey(state)
    if (options.recordInGeneration) {
      const active = this.#activeGenerations.get(key)
      if (active?.id === options.recordInGeneration) {
        active.events.push(snapshot)
      }
    }

    this.#emitEvent(snapshot)
  }
}

export function createInlineRuntime(
  services: ServiceSet,
  repos: Pick<RepositorySet, 'documents' | 'projectDocuments' | 'yjsDocuments'>,
  yjsRuntime: YjsRuntime
): InlineRuntime {
  return new InlineRuntime(services, repos, yjsRuntime)
}
