import { nanoid } from 'nanoid'
import type { UIMessage, UIMessageChunk } from 'ai'
import type { ChatThreadPayload } from '../core/services/chat-thread-payload.js'
import type { ServiceSet } from '../core/services/types.js'
import type { YjsRuntime } from '../yjs/runtime.js'
import { projectSyncBus } from '../trpc/project-sync.js'
import { GenerationEngine, type ChatScope } from './generation-engine.js'
import {
  appendUserMessage,
  assertCanContinueConversationFromPayload,
  pathToUIMessages,
  resolveActivePath,
} from './tree.js'
import {
  ChatRuntimeError,
  createObserveState,
  normalizeMessages,
  toChatKey,
  toPersistedThread,
  type DeleteChatMessageMode,
  type PersistedChatThread,
} from './utils.js'

export interface StartChatGenerationInput extends ChatScope {
  message: string
  contextDocumentId?: string
  selectionFrom?: number
  selectionTo?: number
  assistantNodeId?: string
  promptMessages?: UIMessage[]
  abortRestoreThread?: PersistedChatThread
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
  #activeTreeMutations = new Set<string>()
  #generationEngine: GenerationEngine
  #services: ServiceSet

  constructor(services: ServiceSet, yjsRuntime: YjsRuntime) {
    this.#services = services
    this.#generationEngine = new GenerationEngine(services, yjsRuntime)
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
    this.#emitSnapshot(state)
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

  async updateMessageById(
    scope: ChatScope,
    messageId: string,
    text: string
  ): Promise<PersistedChatThread> {
    const key = this.#beginTreeMutation(scope)
    try {
      const updated = await this.#services.chats.updateMessageById(
        scope.projectId,
        scope.documentId,
        scope.chatId,
        messageId,
        text
      )
      return await this.#publishTreeChange(scope, updated)
    } finally {
      this.#activeTreeMutations.delete(key)
    }
  }

  async deleteMessagesById(
    scope: ChatScope,
    messageId: string,
    mode: DeleteChatMessageMode
  ): Promise<PersistedChatThread> {
    const key = this.#beginTreeMutation(scope)
    try {
      const updated = await this.#services.chats.deleteMessagesById(
        scope.projectId,
        scope.documentId,
        scope.chatId,
        messageId,
        mode
      )
      return await this.#publishTreeChange(scope, updated)
    } finally {
      this.#activeTreeMutations.delete(key)
    }
  }

  async selectBranch(scope: ChatScope, nodeId: string): Promise<PersistedChatThread> {
    const key = this.#beginTreeMutation(scope)
    try {
      const updated = await this.#services.chats.selectBranchById(
        scope.projectId,
        scope.documentId,
        scope.chatId,
        nodeId
      )
      return await this.#publishTreeChange(scope, updated)
    } finally {
      this.#activeTreeMutations.delete(key)
    }
  }

  async regenerateFromMessage(
    scope: ChatScope,
    messageId: string,
    options?: { selectionFrom?: number; selectionTo?: number }
  ): Promise<{ generationId: string }> {
    return this.#forkAndGenerate(scope, messageId, options)
  }

  async editMessageAndGenerate(
    scope: ChatScope,
    messageId: string,
    text: string,
    options?: { selectionFrom?: number; selectionTo?: number }
  ): Promise<{ generationId: string }> {
    const thread = await this.#services.chats.getById(
      scope.projectId,
      scope.documentId,
      scope.chatId
    )
    if (!thread) {
      throw new ChatRuntimeError('NOT_FOUND', `Chat thread ${scope.chatId} not found`)
    }

    const payload: ChatThreadPayload = {
      v: 1,
      settings: thread.settings,
      ...thread.tree,
    }
    const path = resolveActivePath(payload)
    const node = path.find((entry) => entry.id === messageId)
    if (!node) {
      throw new ChatRuntimeError('NOT_FOUND', `Chat message ${messageId} not found`)
    }

    const isLeaf = path[path.length - 1]?.id === messageId

    if (isLeaf && node.role === 'user') {
      await this.updateMessageById(scope, messageId, text)
      return this.startGeneration({
        ...scope,
        message: '',
        selectionFrom: options?.selectionFrom,
        selectionTo: options?.selectionTo,
      })
    }

    if (isLeaf && node.role === 'assistant') {
      await this.updateMessageById(scope, messageId, text)
      return this.regenerateFromMessage(scope, messageId, options)
    }

    if (node.role === 'user') {
      return this.#forkAndGenerate(scope, messageId, { ...options, text })
    }

    return this.#forkAndGenerate(scope, messageId, options)
  }

  async #forkAndGenerate(
    scope: ChatScope,
    messageId: string,
    options?: { text?: string; selectionFrom?: number; selectionTo?: number }
  ): Promise<{ generationId: string }> {
    const key = this.#beginTreeMutation(scope)
    let forkNodeId: string
    let promptMessages: UIMessage[]
    let assistantNodeId: string | undefined
    let abortRestoreThread: PersistedChatThread

    try {
      const existingBeforeFork = await this.#services.chats.getById(
        scope.projectId,
        scope.documentId,
        scope.chatId
      )
      if (!existingBeforeFork) {
        throw new ChatRuntimeError('NOT_FOUND', `Chat thread ${scope.chatId} not found`)
      }
      abortRestoreThread = toPersistedThread(existingBeforeFork)!

      const forked = await this.#services.chats.forkRegenerationById(
        scope.projectId,
        scope.documentId,
        scope.chatId,
        messageId,
        options?.text
      )
      if (!forked) {
        throw new ChatRuntimeError('NOT_FOUND', `Chat thread ${scope.chatId} not found`)
      }

      forkNodeId = forked.forkNodeId
      await this.#publishTreeChange(scope, forked.thread)

      const payload: ChatThreadPayload = {
        v: 1,
        settings: forked.thread.settings,
        ...forked.thread.tree,
      }
      const forkNode = payload.nodes[forkNodeId]
      if (!forkNode) {
        throw new ChatRuntimeError('NOT_FOUND', `Chat message ${forkNodeId} not found`)
      }

      const activePath = resolveActivePath(payload)
      promptMessages =
        forkNode.role === 'assistant'
          ? pathToUIMessages(activePath.slice(0, -1))
          : pathToUIMessages(activePath)
      assistantNodeId = forkNode.role === 'assistant' ? forkNodeId : undefined
    } finally {
      this.#activeTreeMutations.delete(key)
    }

    return this.#runGeneration(scope, {
      ...scope,
      message: '',
      assistantNodeId,
      promptMessages,
      abortRestoreThread,
      selectionFrom: options?.selectionFrom,
      selectionTo: options?.selectionTo,
    })
  }

  #beginTreeMutation(scope: ChatScope): string {
    const key = toChatKey(scope)
    if (this.#activeGenerations.has(key)) {
      throw new ChatRuntimeError(
        'CONFLICT',
        'Stop the current response before editing or deleting messages.'
      )
    }
    if (this.#activeTreeMutations.has(key)) {
      throw new ChatRuntimeError('CONFLICT', 'Chat messages are being updated in another session.')
    }
    this.#activeTreeMutations.add(key)
    return key
  }

  async #publishTreeChange(
    scope: ChatScope,
    updated: Awaited<ReturnType<ServiceSet['chats']['savePayload']>>
  ): Promise<PersistedChatThread> {
    if (!updated) {
      throw new ChatRuntimeError('NOT_FOUND', `Chat thread ${scope.chatId} not found`)
    }

    projectSyncBus.publish({
      type: 'chats.changed',
      projectId: scope.projectId,
      documentId: scope.documentId,
      reason: 'chats.update',
      changedChatIds: [updated.id],
      deletedChatIds: [],
    })
    await this.publishPersistedState(scope)
    return toPersistedThread(updated)!
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
    return this.#runGeneration(input, input)
  }

  async #runGeneration(
    scope: ChatScope,
    input: StartChatGenerationInput
  ): Promise<{ generationId: string }> {
    const key = toChatKey(scope)
    if (this.#activeGenerations.has(key) || this.#activeTreeMutations.has(key)) {
      throw new ChatRuntimeError('CONFLICT', 'Chat generation is already in progress.')
    }

    const promptText = input.message.trim()
    const generationId = nanoid()
    const controller = new AbortController()
    this.#activeGenerations.set(key, { id: generationId, controller })

    try {
      const document = await this.#services.documents.getForProject(
        scope.projectId,
        scope.documentId
      )
      if (!document) {
        throw new ChatRuntimeError(
          'NOT_FOUND',
          `Document ${scope.documentId} not found in project ${scope.projectId}`
        )
      }

      const existingThread = await this.#services.chats.getById(
        scope.projectId,
        scope.documentId,
        scope.chatId
      )
      if (!existingThread) {
        throw new ChatRuntimeError('NOT_FOUND', `Chat thread ${scope.chatId} not found`)
      }

      let rollbackThread = toPersistedThread(existingThread)!
      let liveThread = rollbackThread
      let abortRestoreThread = input.abortRestoreThread ?? rollbackThread
      let promptMessages = input.promptMessages
      let assistantNodeId = input.assistantNodeId ?? `assistant-${generationId}`

      if (input.promptMessages) {
        const reloaded = await this.#services.chats.getById(
          scope.projectId,
          scope.documentId,
          scope.chatId
        )
        if (!reloaded) {
          throw new ChatRuntimeError('NOT_FOUND', `Chat thread ${scope.chatId} not found`)
        }
        liveThread = toPersistedThread(reloaded)!
        promptMessages = input.promptMessages
        assistantNodeId = input.assistantNodeId ?? assistantNodeId
        if (input.abortRestoreThread) {
          abortRestoreThread = input.abortRestoreThread
        }
      } else if (promptText) {
        const payload: ChatThreadPayload = {
          v: 1,
          settings: existingThread.settings,
          ...existingThread.tree,
        }
        const appended = appendUserMessage(payload, promptText)
        const savedWithUser = await this.#services.chats.savePayload(
          scope.projectId,
          scope.documentId,
          scope.chatId,
          appended.payload
        )
        if (!savedWithUser) {
          throw new ChatRuntimeError('NOT_FOUND', `Chat thread ${scope.chatId} not found`)
        }

        projectSyncBus.publish({
          type: 'chats.changed',
          projectId: scope.projectId,
          documentId: scope.documentId,
          reason: 'chats.update',
          changedChatIds: [savedWithUser.id],
          deletedChatIds: [],
        })

        liveThread = toPersistedThread(savedWithUser)!
        abortRestoreThread = liveThread
        rollbackThread = liveThread
        promptMessages = await normalizeMessages(savedWithUser.messages)
      } else {
        assertCanContinueConversationFromPayload({
          v: 1,
          settings: existingThread.settings,
          ...existingThread.tree,
        })
        promptMessages = await normalizeMessages(existingThread.messages)
      }

      if (input.promptMessages && input.abortRestoreThread) {
        rollbackThread = input.abortRestoreThread
      }

      if (!promptMessages) {
        throw new ChatRuntimeError('BAD_REQUEST', 'No prompt context available for generation.')
      }

      this.#emitSnapshot(
        createObserveState(scope, {
          thread: liveThread,
          generating: true,
          generationId,
        })
      )

      void this.#generationEngine.runGeneration(
        {
          scope,
          contextDocumentId: input.contextDocumentId,
          baseThread: liveThread,
          promptMessages,
          rollbackThread,
          abortRestoreThread,
          selectionFrom: input.selectionFrom,
          selectionTo: input.selectionTo,
          editingEnabled: existingThread.settings.editingEnabled,
          generationId,
          assistantNodeId,
          abortController: controller,
        },
        {
          onChunk: ({ generationId: activeGenerationId, chunk }) => {
            this.#emitStreamChunk(scope, activeGenerationId, chunk)
          },
          onProgress: (state) => {
            this.#updateSnapshot(
              createObserveState(scope, {
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
              createObserveState(scope, {
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

export function createChatRuntime(services: ServiceSet, yjsRuntime: YjsRuntime): ChatRuntime {
  return new ChatRuntime(services, yjsRuntime)
}
