import {
  convertToModelMessages,
  readUIMessageStream,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from 'ai'
import { z } from 'zod/v4'
import { isPathInsideDirectory, normalizeDocumentPath, parentDocumentPath } from '@plotline/shared'
import { getLanguageModel } from '../ai/index.js'
import { assertPromptProtocolMode, resolveChatPrompt } from '../ai/prompt-engine.js'
import { documentsRepo } from '../db/index.js'
import { projectSyncBus } from '../trpc/project-sync.js'
import {
  buildCurrentFileContext,
  buildProjectFileIndex,
  createAssistantFailureMessage,
  isAbortError,
  normalizeProjectPath,
  projectDocumentToMarkdown,
  readResponseError,
  serializeConversationForPrompt,
  toModelMessages,
  getToolLimits,
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

    try {
      const currentDocument = await documentsRepo.getDocumentForProject(
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

      const result = streamText({
        model,
        system: `${rendered.systemPrompt}\n\n${rendered.userPrompt}`,
        messages: modelMessages,
        tools: this.buildTools(scope),
        stopWhen: stepCountIs(8),
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

      for await (const assistantMessage of readUIMessageStream<UIMessage>({
        stream: uiMessageStream,
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
      try {
        const { chatsRepo } = await import('../db/index.js')
        const saved = await chatsRepo.saveDocumentChat(
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
    return {
      list_files: tool({
        description:
          'List project files and directories from the project document tree. Use this to discover structure.',
        inputSchema: z.object({
          path: z.string().describe('Directory path to inspect. Use "/" for project root.'),
          recursive: z
            .boolean()
            .optional()
            .describe('Whether to include nested descendants recursively.'),
        }),
        execute: async ({ path, recursive = false }) => {
          const index = await buildProjectFileIndex(
            scope.projectId,
            documentsRepo.listDocumentsForProject
          )
          const normalizedPath = normalizeProjectPath(path)

          if (normalizedPath && index.files.has(normalizedPath)) {
            throw new Error(`Path "${path}" is a file. Use read_file to inspect file contents.`)
          }

          if (normalizedPath && !index.directories.has(normalizedPath)) {
            throw new Error(`Directory "${path}" was not found in this project.`)
          }

          const matchesRecursivePath = (entryPath: string) => {
            if (!recursive) {
              return parentDocumentPath(entryPath) === normalizedPath
            }

            if (!normalizedPath) {
              return entryPath.length > 0
            }

            return isPathInsideDirectory(entryPath, normalizedPath) && entryPath !== normalizedPath
          }

          const directoryEntries = [...index.directories]
            .filter((entry) => entry.length > 0)
            .filter(matchesRecursivePath)
            .map((entry) => ({ type: 'directory' as const, path: entry }))

          const fileEntries = [...index.files.keys()]
            .filter(matchesRecursivePath)
            .map((entry) => ({ type: 'file' as const, path: entry }))

          const allEntries = [...directoryEntries, ...fileEntries].sort((left, right) =>
            left.path.localeCompare(right.path)
          )
          const entries = allEntries.slice(0, getToolLimits().MAX_TOOL_ENTRIES)

          return {
            path: normalizedPath || '/',
            recursive,
            entries,
            totalEntries: allEntries.length,
            hasMore: allEntries.length > entries.length,
          }
        },
      }),
      read_file: tool({
        description:
          'Read a project file by path. Optional line bounds allow partial reads using 1-based inclusive line numbers.',
        inputSchema: z.object({
          path: z.string().describe('File path to read.'),
          start_line: z.number().int().min(1).optional(),
          end_line: z.number().int().min(1).optional(),
        }),
        execute: async ({ path, start_line, end_line }) => {
          const index = await buildProjectFileIndex(
            scope.projectId,
            documentsRepo.listDocumentsForProject
          )
          const normalizedPath = normalizeProjectPath(path)
          const documentId = index.files.get(normalizedPath)

          if (!documentId) {
            if (index.directories.has(normalizedPath)) {
              throw new Error(`Path "${path}" is a directory. Use list_files for directories.`)
            }
            throw new Error(`File "${path}" was not found in this project.`)
          }

          const document = await documentsRepo.getDocumentForProject(scope.projectId, documentId)
          if (!document) {
            throw new Error(`File "${path}" is no longer available in this project.`)
          }

          const fullText = projectDocumentToMarkdown(document.content)
          const lines = fullText.length > 0 ? fullText.split('\n') : ['']
          const totalLines = lines.length
          const start = Math.max(1, Math.min(start_line ?? 1, totalLines))
          const end = Math.max(start, Math.min(end_line ?? totalLines, totalLines))

          let content = lines.slice(start - 1, end).join('\n')
          let truncated = false
          const toolLimits = getToolLimits()
          if (content.length > toolLimits.MAX_TOOL_READ_CHARS) {
            content = content.slice(0, toolLimits.MAX_TOOL_READ_CHARS)
            truncated = true
          }

          return {
            path: normalizedPath,
            start_line: start,
            end_line: end,
            total_lines: totalLines,
            truncated,
            content,
          }
        },
      }),
    }
  }
}
