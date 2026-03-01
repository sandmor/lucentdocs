import express, { type Express } from 'express'
import { stepCountIs, streamText } from 'ai'
import { z } from 'zod/v4'
import { isValidId } from '@plotline/shared'
import {
  generate,
  generateStream,
  createStreamCleaner,
  cleanText,
  getLanguageModel,
} from '../ai/index.js'
import { type AIMode } from '../ai/response-parser.js'
import {
  assertPromptProtocolMode,
  resolveContinuePrompt,
  resolveSelectionPrompt,
} from '../ai/prompt-engine.js'
import { configManager } from '../config/manager.js'
import type { ServiceSet } from '../core/services/types.js'
import {
  buildInlineZoneWriteTools,
  buildReadTools,
  hasValidToolScope,
} from '../chat/tools.js'

interface AiStreamInput {
  mode: 'continue' | 'prompt'
  contextBefore: string
  contextAfter?: string
  hint?: string
  prompt?: string
  conversation?: string
  projectId?: string
  documentId?: string
  selectedText?: string
  maxOutputTokens?: number
}

function buildAiStreamInputSchema() {
  const limits = configManager.getConfig().limits
  return z
    .object({
      mode: z.enum(['continue', 'prompt']),
      contextBefore: z.string().max(limits.contextChars),
      contextAfter: z.string().max(limits.contextChars).optional(),
      hint: z.string().trim().max(limits.hintChars).optional(),
      prompt: z.string().trim().max(limits.promptChars).optional(),
      conversation: z
        .string()
        .max(limits.contextChars)
        .optional(),
      projectId: z.string().max(128).optional(),
      documentId: z.string().max(128).optional(),
      selectedText: z.string().max(limits.contextChars).optional(),
      maxOutputTokens: z.number().int().min(1).optional(),
    })
    .superRefine((value, ctx) => {
      if (value.mode === 'prompt' && !value.prompt?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['prompt'],
          message: 'Prompt is required when mode is "prompt".',
        })
      }
      const totalContext = value.contextBefore.length + (value.contextAfter?.length ?? 0)
      if (totalContext > limits.contextChars) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contextBefore'],
          message: `Combined contextBefore and contextAfter length exceeds ${limits.contextChars} characters.`,
        })
      }

      const hasProjectId = Boolean(value.projectId)
      const hasDocumentId = Boolean(value.documentId)
      if (hasProjectId !== hasDocumentId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['projectId'],
          message: 'projectId and documentId must be provided together',
        })
      }

      if (value.projectId && !isValidId(value.projectId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['projectId'],
          message: 'Invalid projectId format',
        })
      }

      if (value.documentId && !isValidId(value.documentId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['documentId'],
          message: 'Invalid documentId format',
        })
      }
    }) as z.ZodType<AiStreamInput>
}

export function registerAiTextStreamRoute(app: Express, services: ServiceSet): void {
  app.post('/api/ai/stream', async (req, res) => {
    const aiStreamInputSchema = buildAiStreamInputSchema()
    const parsed = aiStreamInputSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ message: 'Invalid AI stream payload', issues: parsed.error.issues })
      return
    }

    const input = parsed.data
    const contextAfter = input.contextAfter ?? null
    const selectedText = input.selectedText ?? null

    if (input.mode === 'continue') {
      await handleContinueStream(
        req,
        res,
        input as typeof input & { mode: 'continue' },
        contextAfter
      )
    } else {
      await handlePromptStream(
        req,
        res,
        input as typeof input & { mode: 'prompt' },
        contextAfter,
        selectedText,
        services
      )
    }
  })
}

async function handleGenericStream(
  req: express.Request,
  res: express.Response,
  options: {
    systemPrompt: string
    userPrompt: string
    maxOutputTokens?: number
    temperature?: number
    onDelta: (
      text: string,
      hasWrittenHeaders: boolean,
      writeHeaders: (mode?: AIMode, insertIndex?: number) => void,
      writeContent: (content: string) => void,
      writeChoice: (choice: string) => void
    ) => void
    generateFallback: (signal: AbortSignal) => Promise<string | null>
    onFallbackDone: (
      fallbackText: string,
      writeHeaders: (mode?: AIMode, insertIndex?: number) => void,
      writeContent: (content: string) => void,
      writeChoice: (choice: string) => void
    ) => boolean
    onFlush?: () => string | null
  }
) {
  const abortController = new AbortController()
  const abortIfClientDisconnected = () => {
    if (!res.writableEnded) abortController.abort()
  }
  req.on('aborted', abortIfClientDisconnected)
  res.on('close', abortIfClientDisconnected)

  let hasWrittenHeaders = false

  const writeHeaders = (mode?: AIMode, insertIndex?: number) => {
    if (!hasWrittenHeaders) {
      res.status(200).set({
        'Content-Type': mode ? 'application/jsonl; charset=utf-8' : 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...(mode ? { 'X-AI-Mode': mode } : {}),
      })
      if (insertIndex !== undefined) res.set('X-AI-Insert-Index', String(insertIndex))
      hasWrittenHeaders = true
    }
  }

  const writeContent = (content: string) => {
    if (hasWrittenHeaders && res.getHeader('X-AI-Mode')) {
      res.write(JSON.stringify(content) + '\n')
    } else {
      res.write(content)
    }
  }

  const writeChoice = (choice: string) => {
    res.write(JSON.stringify(choice) + '\n')
  }

  try {
    const result = await generateStream({
      systemPrompt: options.systemPrompt,
      userPrompt: options.userPrompt,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature ?? 0.85,
      abortSignal: abortController.signal,
    })

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        options.onDelta(part.text, hasWrittenHeaders, writeHeaders, writeContent, writeChoice)
        continue
      }

      if (part.type === 'error') {
        const errMessage =
          part.error instanceof Error ? part.error.message : 'AI provider returned an error'
        if (!hasWrittenHeaders) {
          const fallbackText = await options.generateFallback(abortController.signal)
          if (
            fallbackText &&
            options.onFallbackDone(fallbackText, writeHeaders, writeContent, writeChoice)
          ) {
            res.end()
            return
          }
          res.status(500).json({ message: errMessage })
          return
        }
        res.end()
        return
      }
    }

    if (!hasWrittenHeaders) {
      const fallbackText = await options.generateFallback(abortController.signal)
      if (
        fallbackText &&
        options.onFallbackDone(fallbackText, writeHeaders, writeContent, writeChoice)
      ) {
        res.end()
        return
      }
      res.status(502).json({ message: 'AI stream finished without output' })
      return
    }

    const finalFlush = options.onFlush?.()
    if (finalFlush) writeContent(finalFlush)
    res.end()
  } catch (error: unknown) {
    if (abortController.signal.aborted) {
      if (!res.headersSent) res.end()
      return
    }
    const message = error instanceof Error ? error.message : 'Failed to generate text stream'
    if (!res.headersSent) res.status(500).json({ message })
    else res.end()
  }
}

async function handleContinueStream(
  req: express.Request,
  res: express.Response,
  input: AiStreamInput & { mode: 'continue' },
  contextAfter: string | null
): Promise<void> {
  const rendered = resolveContinuePrompt(input.contextBefore, contextAfter, input.hint)
  assertPromptProtocolMode(rendered.definition, 'continue')

  const cleaner = createStreamCleaner(input.contextBefore, contextAfter)

  await handleGenericStream(req, res, {
    systemPrompt: rendered.systemPrompt,
    userPrompt: rendered.userPrompt,
    maxOutputTokens: input.maxOutputTokens ?? rendered.definition.defaults.maxOutputTokens,
    temperature: rendered.definition.defaults.temperature,
    onDelta: (text, _hasWrittenHeaders, writeHeaders, writeContent) => {
      writeHeaders()
      const content = cleaner.process(text)
      if (content) writeContent(content)
    },
    generateFallback: async (signal) => {
      const fallback = await generate({
        systemPrompt: rendered.systemPrompt,
        userPrompt: rendered.userPrompt,
        maxOutputTokens: input.maxOutputTokens ?? rendered.definition.defaults.maxOutputTokens,
        temperature: rendered.definition.defaults.temperature,
        abortSignal: signal,
      })
      if (!fallback) return null
      return cleanText(fallback, input.contextBefore, contextAfter)
    },
    onFallbackDone: (fallbackText, writeHeaders, writeContent) => {
      writeHeaders()
      writeContent(fallbackText)
      return true
    },
    onFlush: () => cleaner.flush(),
  })
}

async function handlePromptStream(
  req: express.Request,
  res: express.Response,
  input: AiStreamInput & { mode: 'prompt' },
  contextAfter: string | null,
  selectedText: string | null,
  services: ServiceSet
): Promise<void> {
  const rendered = resolveSelectionPrompt(
    input.contextBefore,
    contextAfter,
    input.prompt!.trim(),
    selectedText,
    input.conversation ?? ''
  )
  assertPromptProtocolMode(rendered.definition, 'prompt')
  const abortController = new AbortController()
  const abortIfClientDisconnected = () => {
    if (!res.writableEnded) abortController.abort()
  }
  req.on('aborted', abortIfClientDisconnected)
  res.on('close', abortIfClientDisconnected)

  const writeTools = buildInlineZoneWriteTools({
    onWriteAction: () => {},
  })

  const readTools = hasValidToolScope(input)
    ? buildReadTools({
        scope: {
          projectId: input.projectId,
          documentId: input.documentId,
        },
        services,
      })
    : {}

  const tools = {
    ...readTools,
    ...writeTools,
  }

  try {
    const model = await getLanguageModel()
    const runtimeLimits = configManager.getConfig().limits
    const result = streamText({
      model,
      system: rendered.systemPrompt,
      prompt: rendered.userPrompt,
      tools,
      stopWhen: stepCountIs(runtimeLimits.aiToolSteps),
      maxOutputTokens: input.maxOutputTokens ?? rendered.definition.defaults.maxOutputTokens,
      temperature: rendered.definition.defaults.temperature,
      abortSignal: abortController.signal,
      onError: ({ error }) => {
        console.error('AI inline prompt stream error', error)
      },
    })

    result.pipeUIMessageStreamToResponse(res, {
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'Inline AI stream failed'
        console.error('AI inline prompt UI stream error', error)
        return message
      },
    })
  } catch (error: unknown) {
    if (abortController.signal.aborted) {
      if (!res.headersSent) res.end()
      return
    }

    console.error('AI inline prompt stream failed', error)
    if (!res.headersSent) {
      const message = error instanceof Error ? error.message : 'Failed to generate inline prompt'
      res.status(500).json({ message })
      return
    }
    res.end()
  }
}
