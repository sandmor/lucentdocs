import {
  type PromptEditable,
  promptCreateInputSchema,
  promptDeleteInputSchema,
  promptGetInputSchema,
  promptSetBindingInputSchema,
  promptUpdateInputSchema,
} from '@plotline/shared'
import { TRPCError } from '@trpc/server'
import { PromptManagerError, promptManager } from '../../ai/prompt-manager.js'
import { configManager } from '../../config/runtime.js'
import { adminProcedure, router } from '../index.js'

function assertPromptWithinConfiguredLimits(prompt: PromptEditable): void {
  const limits = configManager.getConfig().limits

  if (prompt.name.length > limits.promptNameChars) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Prompt name exceeds limit of ${limits.promptNameChars} characters`,
    })
  }
  if (prompt.description.length > limits.promptDescChars) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Prompt description exceeds limit of ${limits.promptDescChars} characters`,
    })
  }
  if (prompt.systemTemplate.length > limits.promptSystemChars) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `System template exceeds limit of ${limits.promptSystemChars} characters`,
    })
  }
  if (prompt.userTemplate.length > limits.promptUserChars) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `User template exceeds limit of ${limits.promptUserChars} characters`,
    })
  }
}

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
  list: adminProcedure.query(() => {
    return promptManager.listSummaries()
  }),

  get: adminProcedure.input(promptGetInputSchema).query(({ input }) => {
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

  create: adminProcedure.input(promptCreateInputSchema).mutation(({ input }) => {
    try {
      assertPromptWithinConfiguredLimits(input.prompt)
      const prompt = promptManager.createPrompt(input.prompt)
      return {
        prompt,
        list: promptManager.listSummaries(),
      }
    } catch (error) {
      toTrpcPromptError(error)
    }
  }),

  update: adminProcedure.input(promptUpdateInputSchema).mutation(({ input }) => {
    try {
      assertPromptWithinConfiguredLimits(input.prompt)
      const result = promptManager.updatePrompt(input.id, input.prompt)
      return {
        ...result,
        list: promptManager.listSummaries(),
      }
    } catch (error) {
      toTrpcPromptError(error)
    }
  }),

  delete: adminProcedure.input(promptDeleteInputSchema).mutation(({ input }) => {
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

  setBinding: adminProcedure.input(promptSetBindingInputSchema).mutation(({ input }) => {
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
