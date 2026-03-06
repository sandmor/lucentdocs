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
import type { ServiceSet } from '../core/services/types.js'
import { projectSyncBus } from '../trpc/project-sync.js'
import { buildReadTools } from './tools.js'
import {
  buildCurrentFileContext,
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
  rollbackThread: PersistedChatThread
  rollbackMessages: UIMessage[]
  selectionFrom?: number
  selectionTo?: number
  generationId: string
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
    thread: PersistedChatThread | null
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
      rollbackThread,
      rollbackMessages,
      selectionFrom,
      selectionTo,
      generationId,
      abortController,
    } = options

    let latestAssistantMessage: UIMessage | null = null
    let finalMessages = baseMessages
    let completionError: string | null = null
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

      if (isTestRuntime()) {
        const delayMs = resolveTestChatDelayMs()
        await waitForAbortableDelay(abortController, delayMs)
        if (!abortController.signal.aborted) {
          const promptSeed = extractMessageText(baseMessages[baseMessages.length - 1])
          const assistantMessage: UIMessage = {
            id: `assistant-${generationId}`,
            role: 'assistant',
            parts: [{ type: 'text', text: resolveTestChatResponse(promptSeed) }],
          }
          finalMessages = [...baseMessages, assistantMessage]
          callbacks.onProgress({
            thread: { ...baseThread, messages: finalMessages, updatedAt: Date.now() },
            generating: true,
            generationId,
          })
        }
        return
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
        terminateOnError: true,
      })) {
        const normalizedAssistant: UIMessage = {
          ...assistantMessage,
          id: `assistant-${generationId}`,
        }
        latestAssistantMessage = normalizedAssistant
        finalMessages = [...baseMessages, normalizedAssistant]

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
        completionError = error instanceof Error ? error.message : 'Failed to get AI response'
        console.error('AI chat generation failed', error)
        finalMessages = rollbackMessages
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
            error: completionError,
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
            error: completionError,
          })
        }
      } catch (error) {
        console.error('Failed to finalize chat generation', error)

        callbacks.onComplete({
          thread: {
            ...(completionError ? rollbackThread : baseThread),
            messages: finalMessages,
            updatedAt: Date.now(),
          },
          generating: false,
          generationId: null,
          error: completionError,
        })
      }
    }
  }

  private buildTools(scope: ChatScope) {
    return buildReadTools({ scope, services: this.#services })
  }
}
