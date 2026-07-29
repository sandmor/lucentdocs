import { z } from 'zod/v4'
import { TRPCError } from '@trpc/server'
import { observable } from '@trpc/server/observable'
import { isValidId } from '@lucentdocs/shared'
import { projectSyncBus } from '../project-sync.js'
import { protectedProcedure, router } from '../index.js'
import { ChatRuntimeError } from '../../chat/utils.js'
import type { ChatObserveEvent } from '../../chat/runtime.js'
import { configManager } from '../../config/runtime.js'
import {
  assertMountedDocumentAccess,
  assertProjectAccess,
  subscribeToProjectAccessRevocation,
} from '../access.js'
import { createSubscriptionLifecycle } from '../subscription-lifecycle.js'

const idSchema = z.string().min(1).max(128).refine(isValidId, { message: 'Invalid ID format' })

async function assertChatGenerationAccess(
  ctx: Parameters<typeof assertMountedDocumentAccess>[0],
  input: { projectId: string; documentId: string; chatId: string }
): Promise<void> {
  const thread = await ctx.services.chats.getById(input.projectId, input.documentId, input.chatId)
  if (!thread)
    throw new TRPCError({ code: 'NOT_FOUND', message: `Chat thread ${input.chatId} not found` })
  await assertMountedDocumentAccess(
    ctx,
    input,
    thread.settings.editingEnabled ? 'editor' : 'viewer'
  )
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
  listByProject: protectedProcedure
    .input(z.object({ projectId: idSchema }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      return { threads: await ctx.services.chats.listForProject(input.projectId) }
    }),

  listByDocument: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      await assertMountedDocumentAccess(ctx, input)
      return {
        threads: await ctx.services.chats.listForDocument(input.projectId, input.documentId),
      }
    }),

  getById: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        chatId: idSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      await assertMountedDocumentAccess(ctx, input)
      const state = await ctx.chatRuntime.getObserveState(input)
      if (!state.thread) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Chat thread ${input.chatId} not found`,
        })
      }

      return {
        id: state.thread.id,
        title: state.thread.title,
        messages: state.thread.messages,
        tree: state.thread.tree,
        settings: state.thread.settings,
        createdAt: state.thread.createdAt,
        updatedAt: state.thread.updatedAt,
        generating: state.generating,
        stopping: state.stopping,
        generationId: state.generationId,
      }
    }),

  observeById: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        chatId: idSchema,
      })
    )
    .subscription(({ ctx, input, signal }) => {
      return observable<ChatObserveEvent>((emit) => {
        const lifecycle = createSubscriptionLifecycle(emit, signal)

        void (async () => {
          try {
            await assertMountedDocumentAccess(ctx, input)
            if (lifecycle.closed) return

            const stopAccess = subscribeToProjectAccessRevocation(ctx, input.projectId, (error) => {
              lifecycle.error(error)
            })
            lifecycle.addCleanup(stopAccess)
            if (lifecycle.closed) return

            const stopRuntime = await ctx.chatRuntime.subscribe(input, (state) => {
              lifecycle.next(state)
            })
            lifecycle.addCleanup(stopRuntime)
          } catch (error) {
            lifecycle.error(error instanceof TRPCError ? error : mapRuntimeError(error))
          }
        })()

        return lifecycle.close
      })
    }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        title: z.string().trim().min(1).max(160).optional(),
        editingEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertMountedDocumentAccess(ctx, input, input.editingEnabled ? 'editor' : 'viewer')
      const created = await ctx.services.chats.create(
        input.projectId,
        input.documentId,
        input.title,
        input.editingEnabled
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

  updateSettings: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        chatId: idSchema,
        editingEnabled: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertMountedDocumentAccess(ctx, input, input.editingEnabled ? 'editor' : 'viewer')
      const updated = await ctx.services.chats.updateSettings(
        input.projectId,
        input.documentId,
        input.chatId,
        { editingEnabled: input.editingEnabled }
      )
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Chat thread ${input.chatId} not found`,
        })
      }

      publishChatChangedEvent(input, {
        reason: 'chats.update',
        changedChatIds: [updated.id],
        deletedChatIds: [],
      })
      await ctx.chatRuntime.publishPersistedState({
        projectId: input.projectId,
        documentId: input.documentId,
        chatId: updated.id,
      })

      return {
        id: updated.id,
        settings: updated.settings,
        updatedAt: updated.updatedAt,
      }
    }),

  rename: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        chatId: idSchema,
        title: z.string().trim().min(1).max(160),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertChatGenerationAccess(ctx, input)
      const updated = await ctx.services.chats.rename(
        input.projectId,
        input.documentId,
        input.chatId,
        input.title
      )
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' })
      publishChatChangedEvent(input, {
        reason: 'chats.update',
        changedChatIds: [updated.id],
        deletedChatIds: [],
      })
      return { id: updated.id, title: updated.title, updatedAt: updated.updatedAt }
    }),

  updateMessageById: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        chatId: idSchema,
        messageId: idSchema,
        text: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertMountedDocumentAccess(ctx, input)
      const text = input.text.trim()
      const maxChatMessageChars = configManager.getConfig().limits.chatMessageChars
      if (text.length === 0 || text.length > maxChatMessageChars) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Message must be between 1 and ${maxChatMessageChars} characters`,
        })
      }

      try {
        const updated = await ctx.chatRuntime.updateMessageById(input, input.messageId, text)
        return {
          id: updated.id,
          messages: updated.messages,
          tree: updated.tree,
          settings: updated.settings,
          updatedAt: updated.updatedAt,
        }
      } catch (error) {
        throw mapRuntimeError(error)
      }
    }),

  editMessageAndGenerate: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        chatId: idSchema,
        messageId: idSchema,
        text: z.string(),
        selectionFrom: z.number().int().min(0).optional(),
        selectionTo: z.number().int().min(0).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertChatGenerationAccess(ctx, input)
      const text = input.text.trim()
      const maxChatMessageChars = configManager.getConfig().limits.chatMessageChars
      if (text.length === 0 || text.length > maxChatMessageChars) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Message must be between 1 and ${maxChatMessageChars} characters`,
        })
      }

      try {
        const started = await ctx.chatRuntime.editMessageAndGenerate(
          input,
          input.messageId,
          text,
          ctx.user.id,
          { selectionFrom: input.selectionFrom, selectionTo: input.selectionTo }
        )
        return { accepted: true, generationId: started.generationId }
      } catch (error) {
        throw mapRuntimeError(error)
      }
    }),

  selectBranch: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        chatId: idSchema,
        nodeId: idSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertChatGenerationAccess(ctx, input)

      try {
        const updated = await ctx.chatRuntime.selectBranch(input, input.nodeId)
        return {
          id: updated.id,
          messages: updated.messages,
          tree: updated.tree,
          settings: updated.settings,
          updatedAt: updated.updatedAt,
        }
      } catch (error) {
        throw mapRuntimeError(error)
      }
    }),

  regenerateFromMessage: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        chatId: idSchema,
        messageId: idSchema,
        selectionFrom: z.number().int().min(0).optional(),
        selectionTo: z.number().int().min(0).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertChatGenerationAccess(ctx, input)

      try {
        const started = await ctx.chatRuntime.regenerateFromMessage(
          input,
          input.messageId,
          ctx.user.id,
          {
            selectionFrom: input.selectionFrom,
            selectionTo: input.selectionTo,
          }
        )
        return { accepted: true, generationId: started.generationId }
      } catch (error) {
        throw mapRuntimeError(error)
      }
    }),

  deleteMessagesById: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        chatId: idSchema,
        messageId: idSchema,
        mode: z.enum(['only', 'from_here', 'branch']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertMountedDocumentAccess(ctx, input)

      try {
        const updated = await ctx.chatRuntime.deleteMessagesById(input, input.messageId, input.mode)
        return {
          id: updated.id,
          messages: updated.messages,
          tree: updated.tree,
          settings: updated.settings,
          updatedAt: updated.updatedAt,
        }
      } catch (error) {
        throw mapRuntimeError(error)
      }
    }),

  generateById: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        chatId: idSchema,
        message: z.string(),
        contextDocumentId: idSchema.optional(),
        selectionFrom: z.number().int().min(0).optional(),
        selectionTo: z.number().int().min(0).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertChatGenerationAccess(ctx, input)
      if (input.contextDocumentId) {
        await assertMountedDocumentAccess(ctx, {
          projectId: input.projectId,
          documentId: input.contextDocumentId,
        })
      }
      const message = input.message.trim()
      const maxChatMessageChars = configManager.getConfig().limits.chatMessageChars
      if (message.length > maxChatMessageChars) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Message must be at most ${maxChatMessageChars} characters`,
        })
      }

      try {
        const started = await ctx.chatRuntime.startGeneration({
          ...input,
          message,
          actorUserId: ctx.user.id,
        })
        return { accepted: true, generationId: started.generationId }
      } catch (error) {
        throw mapRuntimeError(error)
      }
    }),

  cancelGenerationById: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        chatId: idSchema,
        generationId: idSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertMountedDocumentAccess(ctx, input)
      // A stop is intentionally chat-scoped: any connected collaborator can
      // stop the active project-assistant run. The optional ID is retained for
      // older clients, but a stale local pump must not block a real stop.
      return { canceled: ctx.chatRuntime.cancelGeneration(input) }
    }),

  deleteById: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        chatId: idSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertMountedDocumentAccess(ctx, input)
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
