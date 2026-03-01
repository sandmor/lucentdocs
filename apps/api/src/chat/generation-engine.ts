import {
  convertToModelMessages,
  readUIMessageStream,
  stepCountIs,
  streamText,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import { normalizeDocumentPath } from '@plotline/shared'
import { getLanguageModel } from '../ai/index.js'
import { assertPromptProtocolMode, resolveChatPrompt } from '../ai/prompt-engine.js'
import { configManager } from '../config/manager.js'
import type { ServiceSet } from '../core/services/types.js'
import { projectSyncBus } from '../trpc/project-sync.js'
import { buildReadTools } from './tools.js'
import {
  buildCurrentFileContext,
  createAssistantFailureMessage,
  isAbortError,
  readResponseError,
  serializeConversationForPrompt,
  toModelMessages,
  type PersistedChatThread,
} from './utils.js'

export interface ChatScope {
  projectId: string
  documentId: string
  chatId: string
}

export interface GenerationOptions {
  scope: ChatScope
  baseThread: PersistedChatThread
  baseMessages: UIMessage[]
  selectionFrom?: number
  selectionTo?: number
  generationId: string
  abortController: AbortController
}

export interface GenerationCallbacks {
  onChunk: (event: {
    generationId: string
    chunk: UIMessageChunk
  }) => void
  onProgress: (state: {
    thread: PersistedChatThread
    generating: boolean
    generationId: string | null
  }) => void
  onComplete: (result: {
    thread: PersistedChatThread | null
    generating: boolean
    generationId: string | null
  }) => void
  createRuntimeError: (code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT', message: string) => Error
}

export class GenerationEngine {
  #services: ServiceSet

  constructor(services: ServiceSet) {
    this.#services = services
  }

  async runGeneration(options: GenerationOptions, callbacks: GenerationCallbacks): Promise<void> {
    const {
      scope,
      baseThread,
      baseMessages,
      selectionFrom,
      selectionTo,
      generationId,
      abortController,
    } = options

    let latestAssistantMessage: UIMessage | null = null
    let finalMessages = baseMessages
    let chunkForwardTask: Promise<void> | null = null
    let chunkReader: ReadableStreamDefaultReader<UIMessageChunk> | null = null

    try {
      const currentDocument = await this.#services.documents.getForProject(
        scope.projectId,
        scope.documentId
      )
      if (!currentDocument) {
        throw callbacks.createRuntimeError(
          'NOT_FOUND',
          `Document ${scope.documentId} not found in project ${scope.projectId}`
        )
      }

      const currentFilePath = normalizeDocumentPath(currentDocument.title) || '(untitled)'
      const currentFileContent = buildCurrentFileContext(
        currentDocument.content,
        selectionFrom,
        selectionTo
      )

      const rendered = resolveChatPrompt(
        currentFilePath,
        currentFileContent,
        serializeConversationForPrompt(baseMessages)
      )
      assertPromptProtocolMode(rendered.definition, 'chat')

      const model = await getLanguageModel()
      const modelMessages = await convertToModelMessages(toModelMessages(baseMessages))
      const runtimeLimits = configManager.getConfig().limits

      const result = streamText({
        model,
        system: `${rendered.systemPrompt}\n\n${rendered.userPrompt}`,
        messages: modelMessages,
        tools: this.buildTools(scope),
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
          if (!isAbortError(error) && !abortController.signal.aborted) {
            console.error('Chat UI chunk forwarding failed', error)
          }
        } finally {
          reader.releaseLock()
        }
      })()

      for await (const assistantMessage of readUIMessageStream<UIMessage>({
        stream: messageStream,
      })) {
        latestAssistantMessage = assistantMessage
        finalMessages = [...baseMessages, assistantMessage]

        callbacks.onProgress({
          thread: { ...baseThread, messages: finalMessages, updatedAt: Date.now() },
          generating: true,
          generationId,
        })
      }

      finalMessages = latestAssistantMessage
        ? [...baseMessages, latestAssistantMessage]
        : baseMessages
    } catch (error) {
      if (!isAbortError(error) && !abortController.signal.aborted) {
        const message = error instanceof Error ? error.message : 'Failed to get AI response'
        console.error('AI chat generation failed', error)

        if (!latestAssistantMessage) {
          const failureMessage = createAssistantFailureMessage(
            `Failed to generate a response: ${message}`
          )
          finalMessages = [...baseMessages, failureMessage]
        } else {
          finalMessages = [...baseMessages, latestAssistantMessage]
        }
      } else {
        finalMessages = latestAssistantMessage
          ? [...baseMessages, latestAssistantMessage]
          : baseMessages
      }
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
        const saved = await this.#services.chats.save(
          scope.projectId,
          scope.documentId,
          scope.chatId,
          finalMessages
        )

        if (!saved) {
          callbacks.onComplete({
            thread: null,
            generating: false,
            generationId: null,
          })
        } else {
          projectSyncBus.publish({
            type: 'chats.changed',
            projectId: scope.projectId,
            documentId: scope.documentId,
            reason: 'chats.update',
            changedChatIds: [saved.id],
            deletedChatIds: [],
          })

          callbacks.onComplete({
            thread: {
              id: saved.id,
              title: saved.title,
              messages: saved.messages,
              createdAt: saved.createdAt,
              updatedAt: saved.updatedAt,
            },
            generating: false,
            generationId: null,
          })
        }
      } catch (error) {
        console.error('Failed to finalize chat generation', error)

        callbacks.onComplete({
          thread: { ...baseThread, messages: finalMessages, updatedAt: Date.now() },
          generating: false,
          generationId: null,
        })
      }
    }
  }

  private buildTools(scope: ChatScope) {
    return buildReadTools({ scope, services: this.#services })
  }
}
