import { observable } from '@trpc/server/observable'
import { nanoid } from 'nanoid'
import {
  readUIMessageStream,
  stepCountIs,
  streamText,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import type {
  ContextParts,
  InlineChatMessage,
  InlineToolChip,
  InlineZoneSession,
  InlineZoneWriteAction,
} from '@lucentdocs/shared'
import type { ServiceSet } from '../core/services/types.js'
import { createStreamCleaner, getLanguageModel } from '../ai/index.js'
import {
  assertPromptProtocolMode,
  resolveContinuePrompt,
  resolveSelectionPrompt,
} from '../ai/prompt-engine.js'
import { configManager } from '../config/runtime.js'
import { buildInlineZoneWriteTools, buildReadTools, hasValidToolScope } from '../chat/tools.js'
import {
  createInlineSessionMetadataStore,
  type InlineScope,
  type InlineSessionMetadataStore,
} from './metadata-store.js'
import type { RepositorySet } from '../core/ports/types.js'
import type { YjsDocumentVersion, YjsRuntime } from '../yjs/runtime.js'
import {
  applyInlineZoneWriteActionToDoc,
  ensureInlineContinuationZoneAtDocumentEnd,
  getInlineZoneSnapshotFromDoc,
  getInlineZoneTextFromDoc,
  setInlineZoneStreamingInDoc,
} from './zone-write.js'
import { getPromptContextForRange, type InlinePromptContextResult } from './context.js'

export interface InlineObserveState extends InlineScope {
  sessionId: string
  seq: number
  deleted: boolean
  generating: boolean
  generationId: string | null
  error: string | null
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

export interface StartInlinePromptGenerationRequest extends InlineScope {
  mode: 'prompt'
  sessionId: string
  prompt: string
  selectionFrom: number
  selectionTo: number
  maxOutputTokens?: number
  requesterClientName?: string
}

export interface StartInlineContinuationGenerationRequest extends InlineScope {
  mode: 'continue'
  sessionId: string
  selectionFrom: number
  selectionTo: number
  maxOutputTokens?: number
  requesterClientName?: string
}

export type StartInlineGenerationRequest =
  | StartInlinePromptGenerationRequest
  | StartInlineContinuationGenerationRequest

type InlineContextResolution = {
  context: InlinePromptContextResult
  selectionFrom: number
  selectionTo: number
  continuationTailAnchor: string
}

interface ResolvedInlinePromptGenerationInput extends InlineScope {
  mode: 'prompt'
  sessionId: string
  contextBefore: string
  contextAfter?: string
  truncated?: boolean
  prompt: string
  selectedText?: string
  selectionFrom: number
  selectionTo: number
  maxOutputTokens?: number
  requesterClientName?: string
}

interface ResolvedInlineContinuationGenerationInput extends InlineScope {
  mode: 'continue'
  sessionId: string
  contextBefore: string
  contextAfter?: string
  truncated?: boolean
  continuationTailAnchor: string
  selectionFrom: number
  selectionTo: number
  maxOutputTokens?: number
  requesterClientName?: string
}

type ResolvedInlineGenerationInput =
  | ResolvedInlinePromptGenerationInput
  | ResolvedInlineContinuationGenerationInput

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
    configManager.getConfig().runtime.nodeEnv === 'test' || process.env.LUCENTDOCS_TEST_MODE === '1'
  )
}

function resolveTestInlineResponse(prompt: string): string {
  const envOverride = process.env.LUCENTDOCS_TEST_INLINE_RESPONSE?.trim()
  if (envOverride) return envOverride

  const normalizedPrompt = prompt.trim().toLowerCase()
  if (normalizedPrompt.includes('mobile')) return 'mobile'
  return 'spark'
}

function resolveTestInlineDelayMs(prompt: string): number {
  const envDelay = Number(process.env.LUCENTDOCS_TEST_INLINE_DELAY_MS ?? '')
  if (Number.isFinite(envDelay) && envDelay > 0) {
    return Math.round(envDelay)
  }

  const normalizedPrompt = prompt.trim().toLowerCase()
  if (normalizedPrompt.includes('slow')) return 1200
  return 0
}

async function waitForAbortableDelay(controller: AbortController, delayMs: number): Promise<void> {
  if (delayMs <= 0) return
  if (controller.signal.aborted) return

  await new Promise<void>((resolve) => {
    const onAbort = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      controller.signal.removeEventListener('abort', onAbort)
      resolve()
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timeoutId = null
      controller.signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)

    controller.signal.addEventListener('abort', onAbort, { once: true })
  })
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
    error?: string | null
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
    error: options.error ?? null,
    session: options.session,
  }
}

const CONTINUATION_TAIL_ANCHOR_CHARS = 512

function createEmptySession(): InlineZoneSession {
  return {
    messages: [],
    choices: [],
    contextBefore: null,
    contextAfter: null,
    contextTruncated: false,
  }
}

function createInlineMessageId(role: 'user' | 'assistant'): string {
  return `inline-${role}-${nanoid()}`
}

function shouldSilenceInlineGenerationError(error: unknown): boolean {
  return error instanceof InlineRuntimeError && error.code === 'NOT_FOUND'
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

function applyReplaceRangeToText(current: string, action: InlineZoneWriteAction): string {
  if (action.type !== 'replace_range') {
    return current
  }

  const fromOffset = Math.max(0, Math.min(action.fromOffset, current.length))
  const toOffset = Math.max(fromOffset, Math.min(action.toOffset, current.length))
  return `${current.slice(0, fromOffset)}${action.content}${current.slice(toOffset)}`
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

/**
 * Coordinates inline AI generation against both persisted session metadata and
 * the live Yjs document.
 *
 * Unlike chat generation, observers may reconnect mid-stream and need both the
 * latest snapshot and every streamed chunk that has not yet been persisted.
 */
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
        // Replaying the buffered generation event log closes the race between a
        // reconnecting subscriber and a generation that is still producing output.
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

  cancelGeneration(scope: InlineScope & { sessionId: string }, generationId?: string): boolean {
    const key = toInlineKey(scope)
    const active = this.#activeGenerations.get(key)
    if (!active) return false
    if (generationId && active.id !== generationId) return false

    active.controller.abort()
    return true
  }

  async #resolveInlineContext(
    request: StartInlineGenerationRequest
  ): Promise<ResolvedInlineGenerationInput> {
    const limits = configManager.getConfig().limits
    const budget = limits.promptExcerptChars

    const resolved = await this.#yjsRuntime.applyProsemirrorTransform<InlineContextResolution>(
      request.documentId,
      {
        transform: (currentDoc) => {
          const zoneSnapshot = getInlineZoneSnapshotFromDoc(currentDoc, request.sessionId)
          const docEnd = currentDoc.content.size

          const rawFrom = Math.max(0, Math.min(request.selectionFrom, docEnd))
          const rawTo = Math.max(0, Math.min(request.selectionTo, docEnd))

          if (request.mode === 'continue') {
            const caretPos = zoneSnapshot.zoneFound
              ? zoneSnapshot.nodeFrom
              : Math.min(rawFrom, rawTo)
            const contextResult = getPromptContextForRange(currentDoc, caretPos, caretPos, budget)
            const anchorWindow = Math.min(caretPos, 8192)
            const anchorText = currentDoc.textBetween(
              Math.max(0, caretPos - anchorWindow),
              caretPos,
              '\n\n',
              '\n'
            )
            const continuationTailAnchor =
              anchorText.length > CONTINUATION_TAIL_ANCHOR_CHARS
                ? anchorText.slice(anchorText.length - CONTINUATION_TAIL_ANCHOR_CHARS)
                : anchorText
            return {
              changed: false,
              nextDoc: currentDoc,
              result: {
                context: contextResult,
                selectionFrom: caretPos,
                selectionTo: caretPos,
                continuationTailAnchor,
              },
            }
          }

          const selectionFrom = zoneSnapshot.zoneFound ? zoneSnapshot.nodeFrom : rawFrom
          const selectionTo = zoneSnapshot.zoneFound ? zoneSnapshot.nodeTo : rawTo
          const contextResult = getPromptContextForRange(
            currentDoc,
            selectionFrom,
            selectionTo,
            budget
          )

          return {
            changed: false,
            nextDoc: currentDoc,
            result: {
              context: contextResult,
              selectionFrom: contextResult.selectionFrom,
              selectionTo: contextResult.selectionTo,
              continuationTailAnchor: '',
            },
          }
        },
      }
    )

    const contextResult = resolved.result.context
    const { parts } = contextResult
    const totalContext = parts.before.length + (parts.after?.length ?? 0)
    if (totalContext > limits.contextChars) {
      throw new InlineRuntimeError(
        'BAD_REQUEST',
        `Combined contextBefore and contextAfter exceeds ${limits.contextChars} characters`
      )
    }

    if (request.mode === 'prompt') {
      if (parts.truncatedMarker) {
        throw new InlineRuntimeError(
          'BAD_REQUEST',
          'Selected text is too large for inline AI. Narrow the selection and try again.'
        )
      }

      if (parts.markerContent.length > limits.contextChars) {
        throw new InlineRuntimeError(
          'BAD_REQUEST',
          `Selected text exceeds ${limits.contextChars} characters`
        )
      }
    }

    if (request.mode === 'prompt') {
      const promptRequest = request
      const promptInput: ResolvedInlinePromptGenerationInput = {
        ...promptRequest,
        contextBefore: parts.before,
        contextAfter: parts.after,
        truncated: parts.truncated,
        selectionFrom: resolved.result.selectionFrom,
        selectionTo: resolved.result.selectionTo,
        selectedText: parts.markerKind === 'selection' ? parts.markerContent : undefined,
      }
      return promptInput
    }

    const continuationRequest = request
    const continuationInput: ResolvedInlineContinuationGenerationInput = {
      ...continuationRequest,
      contextBefore: parts.before,
      contextAfter: parts.after,
      truncated: parts.truncated,
      continuationTailAnchor: resolved.result.continuationTailAnchor,
      selectionFrom: resolved.result.selectionFrom,
      selectionTo: resolved.result.selectionTo,
    }
    return continuationInput
  }

  async startGeneration(request: StartInlineGenerationRequest): Promise<{ generationId: string }> {
    const key = toInlineKey(request)
    if (this.#activeGenerations.has(key)) {
      throw new InlineRuntimeError('CONFLICT', 'Inline generation is already in progress.')
    }

    let prompt: string | null = null
    if (request.mode === 'prompt') {
      prompt = request.prompt.trim()
      const maxPromptChars = configManager.getConfig().limits.promptChars
      if (!prompt || prompt.length > maxPromptChars) {
        throw new InlineRuntimeError(
          'BAD_REQUEST',
          `Prompt must be between 1 and ${maxPromptChars} characters`
        )
      }
    }

    const documentExists = await this.#store.isDocumentInScope(request)
    if (!documentExists) {
      throw new InlineRuntimeError(
        'NOT_FOUND',
        `Document ${request.documentId} not found in project ${request.projectId}`
      )
    }

    const input = await this.#resolveInlineContext(request)

    const persistedSession = await this.#store.getSession(input, input.sessionId)
    if (persistedSession === undefined) {
      throw new InlineRuntimeError(
        'NOT_FOUND',
        `Document ${input.documentId} not found in project ${input.projectId}`
      )
    }

    const baseSession = persistedSession ?? createEmptySession()
    const hasStoredContext = baseSession.contextBefore !== null || baseSession.contextAfter !== null
    const sessionWithContext: InlineZoneSession = {
      ...baseSession,
      contextBefore: baseSession.contextBefore ?? input.contextBefore,
      contextAfter: baseSession.contextAfter ?? input.contextAfter ?? null,
      contextTruncated: hasStoredContext ? baseSession.contextTruncated : input.truncated === true,
    }
    const sessionForGeneration: InlineZoneSession =
      input.mode === 'prompt' && prompt
        ? {
            ...sessionWithContext,
            messages: [...sessionWithContext.messages, createUserMessage(prompt)],
          }
        : sessionWithContext

    const userMessageSaved = await this.#store.saveSession(
      input,
      input.sessionId,
      sessionForGeneration
    )
    if (!userMessageSaved) {
      throw new InlineRuntimeError(
        'NOT_FOUND',
        `Document ${input.documentId} not found in project ${input.projectId}`
      )
    }

    const zoneTextBeforeGeneration = await this.#readZoneText(input)
    const rollbackZoneText =
      zoneTextBeforeGeneration ?? (input.mode === 'prompt' ? (input.selectedText ?? '') : '')
    const documentVersion = this.#yjsRuntime.captureDocumentVersion(input.documentId)

    const generationId = nanoid()
    const controller = new AbortController()
    const requesterClientName = normalizeRequesterClientName(input.requesterClientName)
    const startedState = createObserveState(input, {
      seq: this.#nextSeq(key),
      session: sessionForGeneration,
      generating: true,
      generationId,
      error: null,
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
      sessionForGeneration,
      baseSession,
      rollbackZoneText,
      requesterClientName,
      documentVersion
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

  async #readZoneText(scope: InlineScope & { sessionId: string }): Promise<string | null> {
    const transformed = await this.#yjsRuntime.applyProsemirrorTransform(scope.documentId, {
      transform: (currentDoc) => {
        const zone = getInlineZoneTextFromDoc(currentDoc, scope.sessionId)
        return {
          changed: false,
          nextDoc: currentDoc,
          result: zone,
        }
      },
    })

    return transformed.result.zoneFound ? transformed.result.text : null
  }

  async #setZoneStreaming(
    scope: InlineScope & { sessionId: string },
    streaming: boolean,
    requesterClientName: string
  ): Promise<void> {
    const transformed = await this.#yjsRuntime.applyProsemirrorTransform(scope.documentId, {
      origin: toInlineServerOrigin(requesterClientName),
      transform: (currentDoc) => {
        const applied = setInlineZoneStreamingInDoc(currentDoc, scope.sessionId, streaming)
        return {
          changed: applied.changed,
          nextDoc: applied.nextDoc,
          result: applied,
        }
      },
    })

    if (!transformed.result.zoneFound && streaming) {
      console.warn(
        `AI zone for inline session ${scope.sessionId} was not found while setting streaming=${String(streaming)}`
      )
    }
  }

  /**
   * Recreates a missing continuation zone only after the backing document has
   * been replaced or reloaded since the generation started.
   *
   * This intentionally refuses to recover from arbitrary zone loss in the same
   * live document, which would otherwise resurrect zones after explicit user
   * actions such as reject, accept, or delete.
   */
  async #ensureTerminalContinuationZone(
    scope: InlineScope & { sessionId: string },
    continuationTailAnchor: string,
    contextAfter: string | undefined,
    requesterClientName: string,
    expectedDocumentVersion: YjsDocumentVersion
  ): Promise<boolean> {
    if ((contextAfter ?? '').length > 0) {
      return false
    }

    if (!this.#yjsRuntime.hasDocumentChangedSince(scope.documentId, expectedDocumentVersion)) {
      return false
    }

    const transformed = await this.#yjsRuntime.applyProsemirrorTransform(scope.documentId, {
      origin: toInlineServerOrigin(requesterClientName),
      transform: (currentDoc) => {
        const ensured = ensureInlineContinuationZoneAtDocumentEnd(
          currentDoc,
          scope.sessionId,
          continuationTailAnchor
        )
        return {
          changed: ensured.changed,
          nextDoc: ensured.nextDoc,
          result: ensured,
        }
      },
    })

    return transformed.result.zoneFound
  }

  async #enqueueSessionWrite(
    scope: InlineScope & { sessionId: string },
    task: () => Promise<void>
  ): Promise<void> {
    const key = toInlineKey(scope)
    // Inline tool calls can arrive concurrently from a single generation. Serialize
    // document/session writes so offsets are applied in the same order the model
    // produced them.
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
    input: ResolvedInlineGenerationInput,
    generationId: string,
    controller: AbortController,
    generationSession: InlineZoneSession,
    baselineSession: InlineZoneSession,
    rollbackZoneText: string,
    requesterClientName: string,
    documentVersion: YjsDocumentVersion
  ): Promise<void> {
    const key = toInlineKey(input)
    let finalSession = generationSession
    let zoneDraftText = input.mode === 'prompt' ? (input.selectedText ?? '') : ''
    let generationError: string | null = null

    try {
      if (isTestRuntime()) {
        finalSession = await this.#runTestGeneration(
          input,
          generationId,
          controller,
          generationSession,
          documentVersion
        )
        return
      }

      const model = await getLanguageModel()
      const runtimeLimits = configManager.getConfig().limits

      if (input.mode === 'continue') {
        const contextBefore = generationSession.contextBefore ?? input.contextBefore
        const contextAfter = generationSession.contextAfter ?? input.contextAfter ?? null
        const rendered = resolveContinuePrompt(contextBefore, contextAfter)
        assertPromptProtocolMode(rendered.definition, 'continue')
        const cleaner = createStreamCleaner(contextBefore, contextAfter)
        const result = streamText({
          model,
          system: rendered.systemPrompt,
          prompt: rendered.userPrompt,
          maxOutputTokens: input.maxOutputTokens ?? rendered.definition.defaults.maxOutputTokens,
          temperature: rendered.definition.defaults.temperature,
          abortSignal: controller.signal,
        })

        let generatedText = ''
        const appendGeneratedText = async (rawText: string) => {
          if (!rawText) return
          generatedText += rawText
          zoneDraftText = generatedText

          const fullReplaceAction: InlineZoneWriteAction = {
            type: 'replace_range',
            fromOffset: 0,
            toOffset: Number.MAX_SAFE_INTEGER,
            content: zoneDraftText,
          }

          await this.#enqueueSessionWrite(input, async () => {
            try {
              await this.#applyWriteActionToDocument(input, fullReplaceAction, requesterClientName)
            } catch (error) {
              // Only terminal continuation generations are allowed to recreate a
              // missing zone, and only after the underlying document instance has
              // changed since generation start.
              if (
                !(error instanceof InlineRuntimeError) ||
                error.code !== 'NOT_FOUND' ||
                !(await this.#ensureTerminalContinuationZone(
                  input,
                  input.continuationTailAnchor,
                  input.contextAfter,
                  requesterClientName,
                  documentVersion
                ))
              ) {
                throw error
              }

              await this.#applyWriteActionToDocument(input, fullReplaceAction, requesterClientName)
            }
          })

          const active = this.#activeGenerations.get(key)
          this.#emitSnapshot(
            createObserveState(input, {
              seq: this.#nextSeq(key),
              session: finalSession,
              generating: true,
              generationId,
            }),
            {
              recordInGeneration: active?.id === generationId ? generationId : null,
            }
          )
        }

        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            await appendGeneratedText(cleaner.process(part.text))
            continue
          }
          if (part.type === 'error') {
            throw part.error instanceof Error
              ? part.error
              : new Error('Inline continue generation failed')
          }
        }

        await appendGeneratedText(cleaner.flush())
      } else {
        const prompt = input.prompt.trim()
        const selectedText = input.selectedText ?? null
        const contextParts: ContextParts = {
          before: generationSession.contextBefore ?? input.contextBefore,
          markerKind: selectedText ? 'selection' : 'caret',
          markerContent: selectedText ?? '',
          after: generationSession.contextAfter ?? input.contextAfter ?? undefined,
          truncated: generationSession.contextTruncated,
          truncatedBefore: false,
          truncatedAfter: false,
          truncatedMarker: false,
        }
        const rendered = resolveSelectionPrompt(
          contextParts,
          prompt,
          serializeInlineConversation(generationSession)
        )
        assertPromptProtocolMode(rendered.definition, 'prompt')

        const writeTools = buildInlineZoneWriteTools({
          onWriteAction: async (action) => {
            await this.#enqueueSessionWrite(input, async () => {
              if (action.type === 'replace_range') {
                zoneDraftText = applyReplaceRangeToText(zoneDraftText, action)
                const fullReplaceAction: InlineZoneWriteAction = {
                  type: 'replace_range',
                  fromOffset: 0,
                  toOffset: Number.MAX_SAFE_INTEGER,
                  content: zoneDraftText,
                }
                await this.#applyWriteActionToDocument(
                  input,
                  fullReplaceAction,
                  requesterClientName
                )
              }

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
        let chunkReader: ReadableStreamDefaultReader<UIMessageChunk> | null =
          chunkStream.getReader()
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
            if (
              !(error instanceof Error && error.name === 'AbortError') &&
              !controller.signal.aborted
            ) {
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
          terminateOnError: true,
        })) {
          latestAssistant = assistantMessage
          finalSession = upsertAssistantMessage(finalSession, assistantMessage)

          const active = this.#activeGenerations.get(key)
          this.#emitSnapshot(
            createObserveState(input, {
              seq: this.#nextSeq(key),
              session: finalSession,
              generating: true,
              generationId,
            }),
            {
              recordInGeneration: active?.id === generationId ? generationId : null,
            }
          )
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
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      if (!shouldSilenceInlineGenerationError(error)) {
        console.error('Inline generation failed', error)
      }
      generationError = error instanceof Error ? error.message : 'Inline AI generation failed.'
      finalSession = baselineSession
    } finally {
      if (generationError !== null) {
        try {
          await this.#enqueueSessionWrite(input, async () => {
            // Roll back the zone text on hard failures so the document matches the
            // reverted session state that will be emitted below.
            await this.#applyWriteActionToDocument(
              input,
              {
                type: 'replace_range',
                fromOffset: 0,
                toOffset: Number.MAX_SAFE_INTEGER,
                content: rollbackZoneText,
              },
              requesterClientName
            )
          })
        } catch (error) {
          if (!shouldSilenceInlineGenerationError(error)) {
            console.error('Failed to rollback inline zone content after generation error', error)
          }
        }
      }

      const active = this.#activeGenerations.get(key)
      if (active?.id === generationId) {
        this.#activeGenerations.delete(key)
      }

      try {
        await this.#setZoneStreaming(input, false, requesterClientName)
      } catch (error) {
        console.error('Failed to finalize inline zone streaming state', error)
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
          error: generationError,
        })
      )
    }
  }

  async #runTestGeneration(
    input: ResolvedInlineGenerationInput,
    generationId: string,
    controller: AbortController,
    baseSession: InlineZoneSession,
    documentVersion: YjsDocumentVersion
  ): Promise<InlineZoneSession> {
    if (controller.signal.aborted) return baseSession

    const messageId = `test-inline-${generationId}`
    const testPromptSeed = input.mode === 'prompt' ? input.prompt : 'continue'
    const generated = resolveTestInlineResponse(testPromptSeed)
    const delayMs = resolveTestInlineDelayMs(testPromptSeed)
    await waitForAbortableDelay(controller, delayMs)
    if (controller.signal.aborted) return baseSession

    const assistantMessage: InlineChatMessage = {
      id: messageId,
      role: 'assistant',
      text: generated,
      tools: [],
    }

    if (input.mode === 'continue') {
      const action: InlineZoneWriteAction = {
        type: 'replace_range',
        fromOffset: 0,
        toOffset: Number.MAX_SAFE_INTEGER,
        content: generated,
      }

      await this.#enqueueSessionWrite(input, async () => {
        try {
          await this.#applyWriteActionToDocument(input, action, 'inline-test-runtime')
        } catch (error) {
          if (
            !(error instanceof InlineRuntimeError) ||
            error.code !== 'NOT_FOUND' ||
            !(await this.#ensureTerminalContinuationZone(
              input,
              input.continuationTailAnchor,
              input.contextAfter,
              'inline-test-runtime',
              documentVersion
            ))
          ) {
            throw error
          }

          await this.#applyWriteActionToDocument(input, action, 'inline-test-runtime')
        }
      })

      return baseSession
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
      // Record snapshots alongside chunks so late subscribers can replay a coherent
      // sequence instead of jumping from persisted state to the latest partial UI.
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
