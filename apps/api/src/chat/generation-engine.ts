import {
  convertToModelMessages,
  readUIMessageStream,
  stepCountIs,
  streamText,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import { normalizeDocumentPath } from '@lucentdocs/shared'
import { getLanguageModel } from '../ai/index.js'
import { assertPromptProtocolMode, resolveChatPrompt } from '../ai/prompt-engine.js'
import { configManager } from '../config/runtime.js'
import type { ChatThreadPayload } from '../core/services/chat-thread-payload.js'
import type { ServiceSet } from '../core/services/types.js'
import type { YjsRuntime } from '../yjs/runtime.js'
import { projectSyncBus } from '../trpc/project-sync.js'
import {
  pathToUIMessages,
  resolveActivePath,
  setAssistantOnActiveLeaf,
  toTreeSnapshot,
} from './tree.js'
import { buildEditTools, buildReadTools, buildWriteTools } from './tools.js'
import { DocumentEditSession } from './tools/document-edit-session.js'
import {
  buildCurrentFileContextWithAnnotations,
  isAbortError,
  readResponseError,
  serializeConversationForPrompt,
  toModelMessages,
  toPersistedThread,
  type PersistedChatThread,
} from './utils.js'

export interface ChatScope {
  projectId: string
  documentId: string
  chatId: string
}

export interface GenerationOptions {
  scope: ChatScope
  contextDocumentId?: string
  baseThread: PersistedChatThread
  promptMessages: UIMessage[]
  rollbackThread: PersistedChatThread
  abortRestoreThread: PersistedChatThread
  selectionFrom?: number
  selectionTo?: number
  editingEnabled: boolean
  generationId: string
  assistantNodeId: string
  abortController: AbortController
}

export interface GenerationCallbacks {
  onChunk: (event: { generationId: string; chunk: UIMessageChunk }) => void
  onProgress: (state: {
    thread: PersistedChatThread
    generating: boolean
    generationId: string | null
  }) => void
  onComplete: (result: {
    thread: PersistedChatThread
    generating: boolean
    generationId: string | null
    error: string | null
  }) => void
  createRuntimeError: (code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT', message: string) => Error
}

function isTestRuntime(): boolean {
  return (
    configManager.getConfig().runtime.nodeEnv === 'test' || process.env.LUCENTDOCS_TEST_MODE === '1'
  )
}

function extractMessageText(message: UIMessage | undefined): string {
  const parts = Array.isArray(message?.parts) ? message.parts : []
  return parts
    .flatMap((part) => {
      if (part.type !== 'text') return []
      return typeof part.text === 'string' ? [part.text] : []
    })
    .join('')
}

function resolveTestChatResponse(promptSeed: string): string {
  const envOverride = process.env.LUCENTDOCS_TEST_CHAT_RESPONSE?.trim()
  if (envOverride) return envOverride

  const normalizedPrompt = promptSeed.trim().toLowerCase()
  if (normalizedPrompt.includes('mobile')) return 'mobile'
  return 'spark'
}

function resolveTestChatDelayMs(): number {
  const envDelay = Number(process.env.LUCENTDOCS_TEST_CHAT_DELAY_MS ?? '')
  if (Number.isFinite(envDelay) && envDelay > 0) {
    return Math.round(envDelay)
  }
  return 0
}

async function waitForAbortableDelay(controller: AbortController, delayMs: number): Promise<void> {
  if (delayMs <= 0 || controller.signal.aborted) return

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

function threadToPayload(thread: PersistedChatThread): ChatThreadPayload {
  return {
    v: 1,
    settings: thread.settings,
    nodes: thread.tree.nodes,
    rootChildIds: thread.tree.rootChildIds,
    selectedRootChildId: thread.tree.selectedRootChildId,
  }
}

function buildProgressThread(
  baseThread: PersistedChatThread,
  assistantNodeId: string,
  assistantMessage: UIMessage | null
): PersistedChatThread {
  let payload = threadToPayload(baseThread)
  if (assistantMessage) {
    payload = setAssistantOnActiveLeaf(
      payload,
      assistantNodeId,
      assistantMessage.parts as unknown[]
    )
  }

  const path = resolveActivePath(payload)
  return {
    ...baseThread,
    messages: pathToUIMessages(path),
    tree: toTreeSnapshot(payload),
    updatedAt: Date.now(),
  }
}

function extractAssistantParts(message: UIMessage | null): unknown[] {
  if (!message) return [{ type: 'text', text: '' }]
  return message.parts as unknown[]
}

function toPersistedFromService(
  saved: NonNullable<Awaited<ReturnType<ServiceSet['chats']['getById']>>>
): PersistedChatThread {
  return toPersistedThread(saved)!
}

export class GenerationEngine {
  #services: ServiceSet
  #yjsRuntime: YjsRuntime

  constructor(services: ServiceSet, yjsRuntime: YjsRuntime) {
    this.#services = services
    this.#yjsRuntime = yjsRuntime
  }

  async #resolveFinalThread(
    scope: ChatScope,
    options: {
      saved: Awaited<ReturnType<ServiceSet['chats']['getById']>> | null
      rollbackThread: PersistedChatThread
      baseThread: PersistedChatThread
    }
  ): Promise<PersistedChatThread> {
    if (options.saved) {
      return toPersistedFromService(options.saved)
    }

    const reloaded = await this.#services.chats.getById(
      scope.projectId,
      scope.documentId,
      scope.chatId
    )
    if (reloaded) {
      return toPersistedFromService(reloaded)
    }

    return options.rollbackThread ?? options.baseThread
  }

  async runGeneration(options: GenerationOptions, callbacks: GenerationCallbacks): Promise<void> {
    const {
      scope,
      contextDocumentId = scope.documentId,
      baseThread,
      promptMessages,
      rollbackThread,
      abortRestoreThread,
      selectionFrom,
      selectionTo,
      editingEnabled,
      generationId,
      assistantNodeId,
      abortController,
    } = options

    let latestAssistantMessage: UIMessage | null = null
    let completionError: string | null = null
    let chunkForwardTask: Promise<void> | null = null
    let chunkReader: ReadableStreamDefaultReader<UIMessageChunk> | null = null
    let shouldPersistAssistant = false
    const wasAborted = () => abortController.signal.aborted

    try {
      const currentDocument = await this.#services.documents.getForProject(
        scope.projectId,
        contextDocumentId
      )
      if (!currentDocument) {
        throw callbacks.createRuntimeError(
          'NOT_FOUND',
          `Document ${scope.documentId} not found in project ${scope.projectId}`
        )
      }

      if (isTestRuntime()) {
        const delayMs = resolveTestChatDelayMs()
        await waitForAbortableDelay(abortController, delayMs)
        if (!wasAborted()) {
          const promptSeed = extractMessageText(promptMessages[promptMessages.length - 1])
          latestAssistantMessage = {
            id: assistantNodeId,
            role: 'assistant',
            parts: [{ type: 'text', text: resolveTestChatResponse(promptSeed) }],
          }
          shouldPersistAssistant = true
          callbacks.onProgress({
            thread: buildProgressThread(baseThread, assistantNodeId, latestAssistantMessage),
            generating: true,
            generationId,
          })
        }
        return
      }

      const currentFilePath = normalizeDocumentPath(currentDocument.title) || '(untitled)'
      const noteRows = await this.#services.documentNotes.listByDocumentId(contextDocumentId)
      const fileContext = buildCurrentFileContextWithAnnotations(
        currentDocument.content,
        selectionFrom,
        selectionTo,
        noteRows
      )

      const rendered = resolveChatPrompt(
        currentFilePath,
        fileContext.parts,
        serializeConversationForPrompt(promptMessages),
        fileContext.annotationContent,
        editingEnabled
      )
      assertPromptProtocolMode(rendered.definition, 'chat')

      const model = await getLanguageModel({
        projectId: scope.projectId,
      })
      const modelMessages = await convertToModelMessages(toModelMessages(promptMessages))
      const runtimeLimits = configManager.getConfig().limits

      const result = streamText({
        model,
        system: `${rendered.systemPrompt}\n\n${rendered.userPrompt}`,
        messages: modelMessages,
        tools: this.buildTools({ ...scope, documentId: contextDocumentId }, editingEnabled),
        stopWhen: stepCountIs(runtimeLimits.aiToolSteps),
        maxOutputTokens: rendered.definition.defaults.maxOutputTokens,
        temperature: rendered.definition.defaults.temperature,
        abortSignal: abortController.signal,
      })

      const uiMessageStream = result.toUIMessageStream({
        onError: (error) => {
          console.error('AI chat stream error', error)
          return readResponseError(error)
        },
      })

      const [chunkStream, messageStream] = uiMessageStream.tee()
      chunkReader = chunkStream.getReader()
      chunkForwardTask = (async () => {
        const reader = chunkReader
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            try {
              callbacks.onChunk({
                generationId,
                chunk: value,
              })
            } catch (error) {
              console.error('Failed to forward chat UI chunk', error)
            }
          }
        } catch (error) {
          if (!isAbortError(error) && !wasAborted()) {
            console.error('Chat UI chunk forwarding failed', error)
          }
        } finally {
          reader.releaseLock()
        }
      })()

      for await (const assistantMessage of readUIMessageStream<UIMessage>({
        stream: messageStream,
        terminateOnError: true,
      })) {
        latestAssistantMessage = {
          ...assistantMessage,
          id: assistantNodeId,
        }
        shouldPersistAssistant = true

        callbacks.onProgress({
          thread: buildProgressThread(baseThread, assistantNodeId, latestAssistantMessage),
          generating: true,
          generationId,
        })
      }
    } catch (error) {
      if (!isAbortError(error) && !wasAborted()) {
        completionError = error instanceof Error ? error.message : 'Failed to get AI response'
        console.error('AI chat generation failed', error)
      }
      shouldPersistAssistant = false
    } finally {
      if (chunkReader) {
        try {
          await chunkReader.cancel()
        } catch {
          // Ignore cancellation errors when stream already closed.
        }
      }
      if (chunkForwardTask) {
        try {
          await chunkForwardTask
        } catch (error) {
          console.error('Failed while waiting for chat chunk forward task', error)
        }
      }

      try {
        let saved: Awaited<ReturnType<ServiceSet['chats']['attachAssistantToActiveLeaf']>> = null

        if (shouldPersistAssistant && latestAssistantMessage) {
          saved = await this.#services.chats.attachAssistantToActiveLeaf(
            scope.projectId,
            scope.documentId,
            scope.chatId,
            assistantNodeId,
            extractAssistantParts(latestAssistantMessage)
          )
        } else if (wasAborted()) {
          saved = await this.#services.chats.savePayload(
            scope.projectId,
            scope.documentId,
            scope.chatId,
            threadToPayload(abortRestoreThread)
          )
        } else {
          saved = await this.#services.chats.getById(
            scope.projectId,
            scope.documentId,
            scope.chatId
          )
        }

        const finalThread = await this.#resolveFinalThread(scope, {
          saved,
          rollbackThread,
          baseThread,
        })

        if (saved) {
          projectSyncBus.publish({
            type: 'chats.changed',
            projectId: scope.projectId,
            documentId: scope.documentId,
            reason: 'chats.update',
            changedChatIds: [saved.id],
            deletedChatIds: [],
          })
        }

        callbacks.onComplete({
          thread: finalThread,
          generating: false,
          generationId: null,
          error: completionError,
        })
      } catch (error) {
        console.error('Failed to finalize chat generation', error)

        callbacks.onComplete({
          thread: rollbackThread ?? baseThread,
          generating: false,
          generationId: null,
          error: completionError,
        })
      }
    }
  }

  private buildTools(scope: ChatScope, editingEnabled: boolean) {
    const editSession = new DocumentEditSession()
    const context = {
      scope,
      services: this.#services,
      yjsRuntime: this.#yjsRuntime,
      editSession,
    }
    const tools = buildReadTools(context)
    if (!editingEnabled) return tools
    return {
      ...tools,
      ...buildEditTools(context),
      ...buildWriteTools(context),
    }
  }
}
