import { observable } from '@trpc/server/observable'
import { nanoid } from 'nanoid'
import { stepCountIs, type UIMessageChunk } from 'ai'
import type { ServiceSet } from '../core/services/types.js'
import { getLanguageModel } from '../ai/index.js'
import { assertPromptProtocolMode, resolveSelectionPrompt } from '../ai/prompt-engine.js'
import { configManager } from '../config/manager.js'
import { buildInlineZoneWriteTools, buildReadTools, hasValidToolScope } from '../chat/tools.js'
import { streamText } from 'ai'
import type { InlineZoneSession } from '@plotline/shared'
import {
  createInlineSessionMetadataStore,
  type InlineScope,
  type InlineSessionMetadataStore,
} from './metadata-store.js'
import type { RepositorySet } from '../core/ports/types.js'

export interface InlineObserveState extends InlineScope {
  sessionId: string
  deleted: boolean
  generating: boolean
  generationId: string | null
  session: InlineZoneSession | null
}

export interface InlineObserveSnapshotEvent extends InlineObserveState {
  type: 'snapshot'
}

export interface InlineObserveStreamChunkEvent extends InlineScope {
  type: 'stream-chunk'
  sessionId: string
  generationId: string
  chunk: UIMessageChunk
}

export type InlineObserveEvent = InlineObserveSnapshotEvent | InlineObserveStreamChunkEvent

export interface StartInlineGenerationInput extends InlineScope {
  sessionId: string
  contextBefore: string
  contextAfter?: string
  prompt: string
  selectedText?: string
  conversation?: string
  maxOutputTokens?: number
}

interface ActiveGeneration {
  id: string
  controller: AbortController
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
    session: InlineZoneSession | null
    generating: boolean
    generationId: string | null
  }
): InlineObserveState {
  return {
    projectId: scope.projectId,
    documentId: scope.documentId,
    sessionId: scope.sessionId,
    deleted: options.session === null,
    generating: options.generating,
    generationId: options.generationId,
    session: options.session,
  }
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
  #listeners = new Map<string, Set<InlineListener>>()
  #liveStates = new Map<string, InlineObserveSnapshotEvent>()
  #activeGenerations = new Map<string, ActiveGeneration>()

  constructor(
    services: ServiceSet,
    repos: Pick<RepositorySet, 'documents' | 'projectDocuments' | 'yjsDocuments'>
  ) {
    this.#services = services
    this.#store = createInlineSessionMetadataStore(repos)
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

  async saveSession(
    scope: InlineScope,
    sessionId: string,
    session: InlineZoneSession
  ): Promise<void> {
    const saved = await this.#store.saveSession(scope, sessionId, session)
    if (!saved) {
      throw new InlineRuntimeError(
        'NOT_FOUND',
        `Document ${scope.documentId} not found in project ${scope.projectId}`
      )
    }

    await this.publishPersistedState({ ...scope, sessionId })
  }

  async clearSessionChoices(scope: InlineScope, sessionId: string): Promise<void> {
    const cleared = await this.#store.clearSessionChoices(scope, sessionId)
    if (!cleared) return
    await this.publishPersistedState({ ...scope, sessionId })
  }

  async pruneOrphanSessions(scope: InlineScope): Promise<void> {
    const pruned = await this.#store.pruneOrphans(scope)
    if (!pruned) return
    if (pruned.removedSessionIds.length === 0) return

    for (const sessionId of pruned.removedSessionIds) {
      await this.publishPersistedState({ ...scope, sessionId })
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

    listeners.add(listener)

    try {
      const cachedState = this.#liveStates.get(key)
      if (cachedState) {
        listener(cachedState)
      } else {
        const state = await this.#loadPersistedState(scope)
        this.#emitSnapshot(state)
      }
    } catch (error) {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.#listeners.delete(key)
      }
      throw error
    }

    return () => {
      const current = this.#listeners.get(key)
      if (!current) return

      current.delete(listener)
      if (current.size === 0) {
        this.#listeners.delete(key)
        if (!this.#activeGenerations.has(key)) {
          this.#liveStates.delete(key)
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

  async publishPersistedState(scope: InlineScope & { sessionId: string }): Promise<void> {
    const state = await this.#loadPersistedState(scope)
    this.#emitSnapshot(state)
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

    const generationId = nanoid()
    const controller = new AbortController()
    this.#activeGenerations.set(key, {
      id: generationId,
      controller,
    })

    const currentState = await this.#loadPersistedState(input)
    this.#emitSnapshot({
      ...currentState,
      generating: true,
      generationId,
    })

    void this.#runGeneration(input, generationId, controller)

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

  async #runGeneration(
    input: StartInlineGenerationInput,
    generationId: string,
    controller: AbortController
  ): Promise<void> {
    const key = toInlineKey(input)

    try {
      if (isTestRuntime()) {
        await this.#runTestGeneration(input, generationId, controller)
        return
      }

      const rendered = resolveSelectionPrompt(
        input.contextBefore,
        input.contextAfter ?? null,
        input.prompt,
        input.selectedText ?? null,
        input.conversation ?? ''
      )
      assertPromptProtocolMode(rendered.definition, 'prompt')

      const writeTools = buildInlineZoneWriteTools({
        onWriteAction: () => {},
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

      const chunkStream = result.toUIMessageStream({
        onError: (error) => {
          console.error('AI inline prompt stream error', error)
          return error instanceof Error ? error.message : 'Inline AI stream failed'
        },
      })

      const reader = chunkStream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          this.#emitStreamChunk(input, generationId, value)
        }
      } finally {
        reader.releaseLock()
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        console.error('Inline prompt generation failed', error)
      }
    } finally {
      const active = this.#activeGenerations.get(key)
      if (active?.id === generationId) {
        this.#activeGenerations.delete(key)
      }

      await this.publishPersistedState(input)
    }
  }

  async #runTestGeneration(
    input: StartInlineGenerationInput,
    generationId: string,
    controller: AbortController
  ): Promise<void> {
    if (controller.signal.aborted) return

    const messageId = `test-inline-${generationId}`
    const textId = `test-inline-text-${generationId}`
    const generated = resolveTestInlineResponse(input.prompt)

    const chunks: UIMessageChunk[] = [
      {
        type: 'start',
        messageId,
      } as UIMessageChunk,
      {
        type: 'text-start',
        id: textId,
      } as UIMessageChunk,
      {
        type: 'text-delta',
        id: textId,
        delta: generated,
      } as UIMessageChunk,
      {
        type: 'text-end',
        id: textId,
      } as UIMessageChunk,
      {
        type: 'finish',
      } as UIMessageChunk,
    ]

    for (const chunk of chunks) {
      if (controller.signal.aborted) return
      this.#emitStreamChunk(input, generationId, chunk)
      await Promise.resolve()
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
      session,
      generating: Boolean(activeGeneration),
      generationId: activeGeneration?.id ?? null,
    })
  }

  #emitSnapshot(state: InlineObserveState): void {
    const snapshot: InlineObserveSnapshotEvent = {
      ...state,
      type: 'snapshot',
    }

    const key = toInlineKey(state)
    if (this.#activeGenerations.has(key) || (this.#listeners.get(key)?.size ?? 0) > 0) {
      this.#liveStates.set(key, snapshot)
    } else {
      this.#liveStates.delete(key)
    }

    const listeners = this.#listeners.get(key)
    if (!listeners) return

    for (const listener of listeners) {
      try {
        listener(snapshot)
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
    const listeners = this.#listeners.get(key)
    if (!listeners) return

    const event: InlineObserveStreamChunkEvent = {
      type: 'stream-chunk',
      projectId: scope.projectId,
      documentId: scope.documentId,
      sessionId: scope.sessionId,
      generationId,
      chunk,
    }

    for (const listener of listeners) {
      try {
        listener(event)
      } catch (error) {
        console.error('Inline observe listener failed', error)
      }
    }
  }
}

export function createInlineRuntime(
  services: ServiceSet,
  repos: Pick<RepositorySet, 'documents' | 'projectDocuments' | 'yjsDocuments'>
): InlineRuntime {
  return new InlineRuntime(services, repos)
}
