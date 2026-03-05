import { nanoid } from 'nanoid'
import type { UIMessage, UIMessageChunk } from 'ai'
import type { ServiceSet } from '../core/services/types.js'
import { projectSyncBus } from '../trpc/project-sync.js'
import { GenerationEngine, type ChatScope } from './generation-engine.js'
import {
  buildThreadFromState,
  ChatRuntimeError,
  createObserveState,
  createUserMessage,
  normalizeMessages,
  toChatKey,
  toPersistedThread,
  type PersistedChatThread,
} from './utils.js'

export interface StartChatGenerationInput extends ChatScope {
  message: string
  selectionFrom?: number
  selectionTo?: number
}

export interface ChatObserveState {
  projectId: string
  documentId: string
  chatId: string
  deleted: boolean
  generating: boolean
  generationId: string | null
  error: string | null
  thread: PersistedChatThread | null
}

export interface ChatObserveChunkEvent {
  type: 'stream-chunk'
  projectId: string
  documentId: string
  chatId: string
  generationId: string
  chunk: UIMessageChunk
}

export interface ChatObserveSnapshotEvent extends ChatObserveState {
  type: 'snapshot'
}

export type ChatObserveEvent = ChatObserveSnapshotEvent | ChatObserveChunkEvent

export type { ChatObserveState as ChatObserveStateType }

type ChatStateListener = (event: ChatObserveEvent) => void

interface ActiveGeneration {
  id: string
  controller: AbortController
}

export class ChatRuntime {
  #listeners = new Map<string, Set<ChatStateListener>>()
  #liveStates = new Map<string, ChatObserveSnapshotEvent>()
  #activeGenerations = new Map<string, ActiveGeneration>()
  #generationEngine: GenerationEngine
  #services: ServiceSet

  constructor(services: ServiceSet) {
    this.#services = services
    this.#generationEngine = new GenerationEngine(services)
  }

  #shouldRetainState(key: string): boolean {
    return this.#activeGenerations.has(key) || (this.#listeners.get(key)?.size ?? 0) > 0
  }

  #toSnapshotEvent(state: ChatObserveState): ChatObserveSnapshotEvent {
    return {
      ...state,
      type: 'snapshot',
    }
  }

  #emitSnapshot(state: ChatObserveState): void {
    const snapshot = this.#toSnapshotEvent(state)
    const key = toChatKey(snapshot)
    if (this.#shouldRetainState(key)) {
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
        console.error('Chat observe listener failed', error)
      }
    }
  }

  #updateSnapshot(state: ChatObserveState): void {
    const key = toChatKey(state)
    if (this.#shouldRetainState(key)) {
      this.#liveStates.set(key, this.#toSnapshotEvent(state))
    } else {
      this.#liveStates.delete(key)
    }
  }

  #emitStreamChunk(scope: ChatScope, generationId: string, chunk: UIMessageChunk): void {
    const key = toChatKey(scope)
    const listeners = this.#listeners.get(key)
    if (!listeners) return

    const event: ChatObserveChunkEvent = {
      type: 'stream-chunk',
      projectId: scope.projectId,
      documentId: scope.documentId,
      chatId: scope.chatId,
      generationId,
      chunk,
    }

    for (const listener of listeners) {
      try {
        listener(event)
      } catch (error) {
        console.error('Chat observe listener failed', error)
      }
    }
  }

  #getGenerationState(scope: ChatScope): {
    generating: boolean
    generationId: string | null
  } {
    const active = this.#activeGenerations.get(toChatKey(scope))
    return {
      generating: Boolean(active),
      generationId: active?.id ?? null,
    }
  }

  async #loadPersistedState(scope: ChatScope): Promise<ChatObserveState> {
    const thread = await this.#services.chats.getById(
      scope.projectId,
      scope.documentId,
      scope.chatId
    )
    const persistedThread = toPersistedThread(thread)
    const generationState = this.#getGenerationState(scope)

    return createObserveState(scope, {
      thread: persistedThread,
      generating: generationState.generating,
      generationId: generationState.generationId,
      error: null,
    })
  }

  async subscribe(scope: ChatScope, listener: ChatStateListener): Promise<() => void> {
    const key = toChatKey(scope)
    let listeners = this.#listeners.get(key)
    if (!listeners) {
      listeners = new Set<ChatStateListener>()
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

  async publishPersistedState(scope: ChatScope): Promise<void> {
    const state = await this.#loadPersistedState(scope)
    this.#emitSnapshot(state)
  }

  isGenerating(scope: ChatScope): boolean {
    return this.#activeGenerations.has(toChatKey(scope))
  }

  cancelGeneration(scope: ChatScope, generationId?: string): boolean {
    const active = this.#activeGenerations.get(toChatKey(scope))
    if (!active) return false
    if (generationId && active.id !== generationId) return false
    active.controller.abort()
    return true
  }

  markDeleted(scope: ChatScope): void {
    this.cancelGeneration(scope)
    this.#activeGenerations.delete(toChatKey(scope))

    this.#emitSnapshot(
      createObserveState(scope, {
        thread: null,
        generating: false,
        generationId: null,
        error: null,
      })
    )
  }

  async startGeneration(input: StartChatGenerationInput): Promise<{ generationId: string }> {
    const key = toChatKey(input)
    if (this.#activeGenerations.has(key)) {
      throw new ChatRuntimeError('CONFLICT', 'Chat generation is already in progress.')
    }

    const promptText = input.message.trim()
    if (!promptText) {
      throw new ChatRuntimeError('BAD_REQUEST', 'Message is required to start generation.')
    }

    const generationId = nanoid()
    const controller = new AbortController()
    this.#activeGenerations.set(key, { id: generationId, controller })

    try {
      const document = await this.#services.documents.getForProject(
        input.projectId,
        input.documentId
      )
      if (!document) {
        throw new ChatRuntimeError(
          'NOT_FOUND',
          `Document ${input.documentId} not found in project ${input.projectId}`
        )
      }

      const existingThread = await this.#services.chats.getById(
        input.projectId,
        input.documentId,
        input.chatId
      )
      if (!existingThread) {
        throw new ChatRuntimeError('NOT_FOUND', `Chat thread ${input.chatId} not found`)
      }

      const persistedMessages = await normalizeMessages(existingThread.messages)
      const rollbackThread = toPersistedThread(existingThread)!
      const userMessage = createUserMessage(promptText)
      const baseMessages: UIMessage[] = [...persistedMessages, userMessage]

      const savedWithUser = await this.#services.chats.save(
        input.projectId,
        input.documentId,
        input.chatId,
        baseMessages
      )
      if (!savedWithUser) {
        throw new ChatRuntimeError('NOT_FOUND', `Chat thread ${input.chatId} not found`)
      }

      projectSyncBus.publish({
        type: 'chats.changed',
        projectId: input.projectId,
        documentId: input.documentId,
        reason: 'chats.update',
        changedChatIds: [savedWithUser.id],
        deletedChatIds: [],
      })

      const liveThread = buildThreadFromState(
        toPersistedThread(savedWithUser)!,
        baseMessages,
        Date.now()
      )

      this.#emitSnapshot(
        createObserveState(input, {
          thread: liveThread,
          generating: true,
          generationId,
        })
      )

      void this.#generationEngine.runGeneration(
        {
          scope: input,
          baseThread: liveThread,
          baseMessages,
          rollbackThread,
          rollbackMessages: persistedMessages,
          selectionFrom: input.selectionFrom,
          selectionTo: input.selectionTo,
          generationId,
          abortController: controller,
        },
        {
          onChunk: ({ generationId: activeGenerationId, chunk }) => {
            this.#emitStreamChunk(input, activeGenerationId, chunk)
          },
          onProgress: (state) => {
            this.#updateSnapshot(
              createObserveState(input, {
                thread: state.thread,
                generating: true,
                generationId: state.generationId,
                error: null,
              })
            )
          },
          onComplete: (result) => {
            const active = this.#activeGenerations.get(key)
            if (active?.id === generationId) {
              this.#activeGenerations.delete(key)
            }

            this.#emitSnapshot(
              createObserveState(input, {
                thread: result.thread,
                generating: false,
                generationId: null,
                error: result.error ?? null,
              })
            )
          },
          createRuntimeError: (code, message) => new ChatRuntimeError(code, message),
        }
      )

      return { generationId }
    } catch (error) {
      const active = this.#activeGenerations.get(key)
      if (active?.id === generationId) {
        this.#activeGenerations.delete(key)
      }
      throw error
    }
  }
}

export function createChatRuntime(services: ServiceSet): ChatRuntime {
  return new ChatRuntime(services)
}
