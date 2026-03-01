import { z } from 'zod/v4'
import { TRPCError } from '@trpc/server'
import { observable } from '@trpc/server/observable'
import { isValidId } from '@plotline/shared'
import { projectSyncBus } from '../project-sync.js'
import { publicProcedure, router } from '../index.js'
import { ChatRuntimeError } from '../../chat/utils.js'
import type { ChatObserveEvent } from '../../chat/runtime.js'
import { configManager } from '../../config/manager.js'

const idSchema = z.string().min(1).max(128).refine(isValidId, { message: 'Invalid ID format' })

async function assertProjectDocument(
  projectId: string,
  documentId: string,
  services: { documents: { getForProject: (p: string, d: string) => Promise<unknown | null> } }
): Promise<void> {
  const document = await services.documents.getForProject(projectId, documentId)
  if (!document) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Document ${documentId} not found in project ${projectId}`,
    })
  }
}

function publishChatChangedEvent(
  input: { projectId: string; documentId: string },
  options: {
    reason: 'chats.create' | 'chats.update' | 'chats.delete'
    changedChatIds: string[]
    deletedChatIds: string[]
  }
): void {
  projectSyncBus.publish({
    type: 'chats.changed',
    projectId: input.projectId,
    documentId: input.documentId,
    reason: options.reason,
    changedChatIds: options.changedChatIds,
    deletedChatIds: options.deletedChatIds,
  })
}

function mapRuntimeError(error: unknown): TRPCError {
  if (!(error instanceof ChatRuntimeError)) {
    return new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: error instanceof Error ? error.message : 'Failed to process chat runtime request',
    })
  }

  if (error.code === 'NOT_FOUND') {
    return new TRPCError({ code: 'NOT_FOUND', message: error.message })
  }

  if (error.code === 'CONFLICT') {
    return new TRPCError({ code: 'CONFLICT', message: error.message })
  }

  return new TRPCError({ code: 'BAD_REQUEST', message: error.message })
}

export const chatRouter = router({
  listByDocument: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      await assertProjectDocument(input.projectId, input.documentId, ctx.services)
      return {
        threads: await ctx.services.chats.listForDocument(input.projectId, input.documentId),
      }
    }),

  getById: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        chatId: idSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      await assertProjectDocument(input.projectId, input.documentId, ctx.services)
      const thread = await ctx.services.chats.getById(
        input.projectId,
        input.documentId,
        input.chatId
      )
      if (!thread) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Chat thread ${input.chatId} not found`,
        })
      }

      return {
        id: thread.id,
        title: thread.title,
        messages: thread.messages,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        generating: ctx.chatRuntime.isGenerating(input),
      }
    }),

  observeById: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        chatId: idSchema,
      })
    )
    .subscription(({ ctx, input, signal }) => {
      return observable<ChatObserveEvent>((emit) => {
        let closed = false
        let unsubscribe: (() => void) | null = null

        void ctx.chatRuntime
          .subscribe(input, (state) => {
            emit.next(state)
          })
          .then((nextUnsubscribe) => {
            if (closed) {
              nextUnsubscribe()
              return
            }
            unsubscribe = nextUnsubscribe
          })
          .catch((error) => {
            emit.error(mapRuntimeError(error))
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
    }),

  create: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        title: z.string().trim().min(1).max(160).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectDocument(input.projectId, input.documentId, ctx.services)
      const created = await ctx.services.chats.create(
        input.projectId,
        input.documentId,
        input.title
      )
      if (!created) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create chat thread',
        })
      }

      publishChatChangedEvent(input, {
        reason: 'chats.create',
        changedChatIds: [created.id],
        deletedChatIds: [],
      })
      await ctx.chatRuntime.publishPersistedState({
        projectId: input.projectId,
        documentId: input.documentId,
        chatId: created.id,
      })

      return created
    }),

  generateById: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        chatId: idSchema,
        message: z.string(),
        selectionFrom: z.number().int().min(0).optional(),
        selectionTo: z.number().int().min(0).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectDocument(input.projectId, input.documentId, ctx.services)
      const message = input.message.trim()
      const maxChatMessageChars = configManager.getConfig().limits.chatMessageChars
      if (message.length === 0 || message.length > maxChatMessageChars) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Message must be between 1 and ${maxChatMessageChars} characters`,
        })
      }

      try {
        const started = await ctx.chatRuntime.startGeneration({ ...input, message })
        return { accepted: true, generationId: started.generationId }
      } catch (error) {
        throw mapRuntimeError(error)
      }
    }),

  cancelGenerationById: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        chatId: idSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectDocument(input.projectId, input.documentId, ctx.services)
      return { canceled: ctx.chatRuntime.cancelGeneration(input) }
    }),

  deleteById: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        chatId: idSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectDocument(input.projectId, input.documentId, ctx.services)
      const deleted = await ctx.services.chats.delete(
        input.projectId,
        input.documentId,
        input.chatId
      )
      if (!deleted) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Chat thread ${input.chatId} not found`,
        })
      }

      publishChatChangedEvent(input, {
        reason: 'chats.delete',
        changedChatIds: [],
        deletedChatIds: [input.chatId],
      })
      ctx.chatRuntime.markDeleted(input)

      return { deleted: true }
    }),
})
