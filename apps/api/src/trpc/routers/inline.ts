import { z } from 'zod/v4'
import { TRPCError } from '@trpc/server'
import { isValidId, type InlineZoneSession } from '@plotline/shared'
import { publicProcedure, router } from '../index.js'
import { InlineRuntimeError } from '../../inline/runtime.js'
import { configManager } from '../../config/manager.js'

const idSchema = z.string().min(1).max(128).refine(isValidId, { message: 'Invalid ID format' })

const inlineToolChipSchema = z.object({
  toolName: z.string().trim().min(1).max(120),
  state: z.enum(['pending', 'complete']),
})

const inlineMessageSchema = z.object({
  id: z.string().trim().min(1).max(200),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  tools: z.array(inlineToolChipSchema),
})

const inlineSessionSchema: z.ZodType<InlineZoneSession> = z.object({
  messages: z.array(inlineMessageSchema),
  choices: z.array(z.string()),
  contextBefore: z.string().nullable(),
  contextAfter: z.string().nullable(),
})

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
  getSessions: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        sessionIds: z.array(idSchema).min(1).max(64),
      })
    )
    .query(async ({ ctx, input }) => {
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

  saveSession: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        sessionId: idSchema,
        session: inlineSessionSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.inlineRuntime.saveSession(
          {
            projectId: input.projectId,
            documentId: input.documentId,
          },
          input.sessionId,
          input.session
        )
        return {
          saved: true,
        }
      } catch (error) {
        throw mapRuntimeError(error)
      }
    }),

  clearSessionChoices: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        sessionId: idSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.inlineRuntime.clearSessionChoices(
          {
            projectId: input.projectId,
            documentId: input.documentId,
          },
          input.sessionId
        )
        return {
          cleared: true,
        }
      } catch (error) {
        throw mapRuntimeError(error)
      }
    }),

  pruneOrphans: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
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

  startPromptGeneration: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        sessionId: idSchema,
        contextBefore: z.string(),
        contextAfter: z.string().optional(),
        prompt: z.string(),
        selectedText: z.string().optional(),
        conversation: z.string().optional(),
        maxOutputTokens: z.number().int().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
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

      if ((input.conversation?.length ?? 0) > limits.contextChars) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Conversation exceeds ${limits.contextChars} characters`,
        })
      }

      try {
        return await ctx.inlineRuntime.startGeneration(input)
      } catch (error) {
        throw mapRuntimeError(error)
      }
    }),

  cancelGeneration: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        sessionId: idSchema,
      })
    )
    .mutation(({ ctx, input }) => {
      return {
        canceled: ctx.inlineRuntime.cancelGeneration(input),
      }
    }),

  observeSession: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        documentId: idSchema,
        sessionId: idSchema,
      })
    )
    .subscription(({ ctx, input, signal }) => {
      try {
        return ctx.inlineRuntime.observe(input, signal)
      } catch (error) {
        throw mapRuntimeError(error)
      }
    }),
})
