import { z } from 'zod/v4'
import { TRPCError } from '@trpc/server'
import { observable } from '@trpc/server/observable'
import { isValidId } from '@lucentdocs/shared'
import { protectedProcedure, router } from '../index.js'
import { InlineRuntimeError, type InlineObserveEvent } from '../../inline/runtime.js'
import { configManager } from '../../config/runtime.js'
import { assertProjectAccess, subscribeToProjectAccessRevocation } from '../access.js'

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
      await assertProjectAccess(ctx, input.projectId)
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
      await assertProjectAccess(ctx, input.projectId)
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
        contextBefore: z.string(),
        contextAfter: z.string().optional(),
        prompt: z.string(),
        selectedText: z.string().optional(),
        maxOutputTokens: z.number().int().min(1).optional(),
        requesterClientName: idSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const limits = configManager.getConfig().limits
      const totalContext = input.contextBefore.length + (input.contextAfter?.length ?? 0)
      if (totalContext > limits.contextChars) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Combined contextBefore and contextAfter exceeds ${limits.contextChars} characters`,
        })
      }

      if (input.prompt.trim().length === 0 || input.prompt.length > limits.promptChars) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Prompt must be between 1 and ${limits.promptChars} characters`,
        })
      }

      if ((input.selectedText?.length ?? 0) > limits.contextChars) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Selected text exceeds ${limits.contextChars} characters`,
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
        contextBefore: z.string(),
        contextAfter: z.string().optional(),
        maxOutputTokens: z.number().int().min(1).optional(),
        requesterClientName: idSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const limits = configManager.getConfig().limits
      const totalContext = input.contextBefore.length + (input.contextAfter?.length ?? 0)
      if (totalContext > limits.contextChars) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Combined contextBefore and contextAfter exceeds ${limits.contextChars} characters`,
        })
      }

      try {
        return await ctx.inlineRuntime.startGeneration({
          ...input,
          mode: 'continue',
        })
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
      await assertProjectAccess(ctx, input.projectId)
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
        let closed = false
        let unsubscribe: (() => void) | null = null
        let unsubscribeAccess: (() => void) | null = null

        void assertProjectAccess(ctx, input.projectId)
          .then(() => {
            unsubscribeAccess = subscribeToProjectAccessRevocation(
              ctx,
              input.projectId,
              (error) => {
                if (closed) return
                closed = true
                unsubscribe?.()
                unsubscribeAccess?.()
                emit.error(error)
              }
            )

            return ctx.inlineRuntime.subscribe(input, (event) => {
              emit.next(event)
            })
          })
          .then((nextUnsubscribe) => {
            if (closed) {
              nextUnsubscribe()
              return
            }
            unsubscribe = nextUnsubscribe
          })
          .catch((error) => {
            emit.error(error instanceof TRPCError ? error : mapRuntimeError(error))
          })

        const onAbort = () => {
          closed = true
          unsubscribe?.()
          unsubscribeAccess?.()
        }

        signal?.addEventListener('abort', onAbort)

        return () => {
          closed = true
          signal?.removeEventListener('abort', onAbort)
          unsubscribe?.()
          unsubscribeAccess?.()
        }
      })
    }),
})
