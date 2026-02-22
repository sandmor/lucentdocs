import {
  promptCreateInputSchema,
  promptDeleteInputSchema,
  promptGetInputSchema,
  promptSetBindingInputSchema,
  promptUpdateInputSchema,
} from '@plotline/shared'
import { TRPCError } from '@trpc/server'
import { PromptManagerError, promptManager } from '../../ai/prompt-manager.js'
import { router, publicProcedure } from '../index.js'

function toTrpcPromptError(error: unknown): never {
  if (error instanceof TRPCError) throw error
  if (error instanceof PromptManagerError) {
    throw new TRPCError({
      code: error.code,
      message: error.message,
      cause: error,
    })
  }
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: error instanceof Error ? error.message : 'Prompt operation failed',
    cause: error instanceof Error ? error : undefined,
  })
}

export const promptsRouter = router({
  list: publicProcedure.query(() => {
    return promptManager.listSummaries()
  }),

  get: publicProcedure.input(promptGetInputSchema).query(({ input }) => {
    try {
      const prompt = promptManager.getPrompt(input.id)
      if (!prompt) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Prompt ${input.id} not found`,
        })
      }
      return prompt
    } catch (error) {
      toTrpcPromptError(error)
    }
  }),

  create: publicProcedure.input(promptCreateInputSchema).mutation(({ input }) => {
    try {
      const prompt = promptManager.createPrompt(input.prompt)
      return {
        prompt,
        list: promptManager.listSummaries(),
      }
    } catch (error) {
      toTrpcPromptError(error)
    }
  }),

  update: publicProcedure.input(promptUpdateInputSchema).mutation(({ input }) => {
    try {
      const result = promptManager.updatePrompt(input.id, input.prompt)
      return {
        ...result,
        list: promptManager.listSummaries(),
      }
    } catch (error) {
      toTrpcPromptError(error)
    }
  }),

  delete: publicProcedure.input(promptDeleteInputSchema).mutation(({ input }) => {
    try {
      const deleted = promptManager.deletePrompt(input.id)
      return {
        ...deleted,
        list: promptManager.listSummaries(),
      }
    } catch (error) {
      toTrpcPromptError(error)
    }
  }),

  setBinding: publicProcedure.input(promptSetBindingInputSchema).mutation(({ input }) => {
    try {
      const result = promptManager.setBinding(input.slot, input.promptId)
      return {
        ...result,
        list: promptManager.listSummaries(),
      }
    } catch (error) {
      toTrpcPromptError(error)
    }
  }),
})
