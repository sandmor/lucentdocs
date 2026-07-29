import { z } from 'zod/v4'
import { TRPCError } from '@trpc/server'
import { observable } from '@trpc/server/observable'
import { isValidId } from '@lucentdocs/shared'
import { protectedProcedure, router } from '../index.js'
import { InlineRuntimeError, type InlineObserveEvent } from '../../inline/runtime.js'
import { configManager } from '../../config/runtime.js'
import { assertMountedDocumentAccess, subscribeToProjectAccessRevocation } from '../access.js'
import { createSubscriptionLifecycle } from '../subscription-lifecycle.js'

const idSchema = z.string().min(1).max(128).refine(isValidId, { message: 'Invalid ID format' })

function mapRuntimeError(error: unknown): TRPCError {
  if (!(error instanceof InlineRuntimeError)) {
    return new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: error instanceof Error ? error.message : 'Inline runtime request failed',
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

export const inlineRouter = router({
  getSessions: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        sessionIds: z.array(idSchema).min(1).max(64),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertMountedDocumentAccess(ctx, input)
      try {
        const sessions = await ctx.inlineRuntime.getSessions(
          {
            projectId: input.projectId,
            documentId: input.documentId,
          },
          input.sessionIds
        )
        return {
          sessions,
        }
      } catch (error) {
        throw mapRuntimeError(error)
      }
    }),

  pruneOrphans: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertMountedDocumentAccess(ctx, input, 'editor')
      try {
        await ctx.inlineRuntime.pruneOrphanSessions({
          projectId: input.projectId,
          documentId: input.documentId,
        })
        return {
          pruned: true,
        }
      } catch (error) {
        throw mapRuntimeError(error)
      }
    }),

  startPromptGeneration: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        sessionId: idSchema,
        prompt: z.string(),
        selectionFrom: z.number().int().min(0),
        selectionTo: z.number().int().min(0),
        maxOutputTokens: z.number().int().min(1).optional(),
        requesterClientName: idSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertMountedDocumentAccess(ctx, input, 'editor')
      const limits = configManager.getConfig().limits
      if (input.prompt.trim().length === 0 || input.prompt.length > limits.promptChars) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Prompt must be between 1 and ${limits.promptChars} characters`,
        })
      }

      try {
        return await ctx.inlineRuntime.startGeneration({
          ...input,
          mode: 'prompt',
        })
      } catch (error) {
        throw mapRuntimeError(error)
      }
    }),

  startContinuationGeneration: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        sessionId: idSchema,
        selectionFrom: z.number().int().min(0),
        selectionTo: z.number().int().min(0),
        maxOutputTokens: z.number().int().min(1).optional(),
        requesterClientName: idSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertMountedDocumentAccess(ctx, input, 'editor')
      try {
        return await ctx.inlineRuntime.startGeneration({
          ...input,
          mode: 'continue',
        })
      } catch (error) {
        throw mapRuntimeError(error)
      }
    }),

  undoSessionTurn: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        sessionId: idSchema,
        requesterClientName: idSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertMountedDocumentAccess(ctx, input, 'editor')
      try {
        const session = await ctx.inlineRuntime.undoSessionTurn(input, input.requesterClientName)
        return { session }
      } catch (error) {
        throw mapRuntimeError(error)
      }
    }),

  redoSessionTurn: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        sessionId: idSchema,
        requesterClientName: idSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertMountedDocumentAccess(ctx, input, 'editor')
      try {
        const session = await ctx.inlineRuntime.redoSessionTurn(input, input.requesterClientName)
        return { session }
      } catch (error) {
        throw mapRuntimeError(error)
      }
    }),

  restoreAcceptedSessionZone: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        sessionId: idSchema,
        requesterClientName: idSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertMountedDocumentAccess(ctx, input, 'editor')
      try {
        const session = await ctx.inlineRuntime.restoreAcceptedSessionZone(
          input,
          input.requesterClientName
        )
        return { session }
      } catch (error) {
        throw mapRuntimeError(error)
      }
    }),

  cancelGeneration: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        sessionId: idSchema,
        generationId: idSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertMountedDocumentAccess(ctx, input, 'editor')
      return {
        canceled: ctx.inlineRuntime.cancelGeneration(input, input.generationId),
      }
    }),

  observeSession: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        sessionId: idSchema,
      })
    )
    .subscription(({ ctx, input, signal }) => {
      return observable<InlineObserveEvent>((emit) => {
        const lifecycle = createSubscriptionLifecycle(emit, signal)

        const fail = (error: unknown) => {
          lifecycle.error(error instanceof TRPCError ? error : mapRuntimeError(error))
        }

        void (async () => {
          try {
            await assertMountedDocumentAccess(ctx, input)
            if (lifecycle.closed) return

            const stopAccess = subscribeToProjectAccessRevocation(ctx, input.projectId, fail)
            lifecycle.addCleanup(stopAccess)
            if (lifecycle.closed) return

            const stopRuntime = await ctx.inlineRuntime.subscribe(input, (event) => {
              lifecycle.next(event)
            })
            lifecycle.addCleanup(stopRuntime)
          } catch (error) {
            fail(error)
          }
        })()

        return lifecycle.close
      })
    }),
})
