import express, { type Express } from 'express'
import { z } from 'zod/v4'
import { generate, generateStream, createStreamCleaner, cleanText } from '../ai/index.js'
import { assertPromptProtocolMode, resolveContinuePrompt } from '../ai/prompt-engine.js'

interface ContinueStreamInput {
  mode: 'continue'
  contextBefore: string
  contextAfter?: string
  hint?: string
  maxOutputTokens?: number
}

const continueStreamInputSchema = z
  .object({
    mode: z.literal('continue'),
    contextBefore: z.string(),
    contextAfter: z.string().optional(),
    hint: z.string().trim().optional(),
    maxOutputTokens: z.number().int().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const totalContext = value.contextBefore.length + (value.contextAfter?.length ?? 0)
    if (totalContext > 120_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contextBefore'],
        message: 'Combined contextBefore and contextAfter are too large.',
      })
    }
  }) as z.ZodType<ContinueStreamInput>

export function registerAiTextStreamRoute(app: Express): void {
  app.post('/api/ai/stream', async (req, res) => {
    const parsed = continueStreamInputSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ message: 'Invalid AI stream payload', issues: parsed.error.issues })
      return
    }

    const input = parsed.data
    const contextAfter = input.contextAfter ?? null

    await handleContinueStream(req, res, input, contextAfter)
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
      writeHeaders: () => void,
      writeContent: (content: string) => void
    ) => void
    generateFallback: (signal: AbortSignal) => Promise<string | null>
    onFallbackDone: (fallbackText: string, writeHeaders: () => void, writeContent: (content: string) => void) => boolean
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

  const writeHeaders = () => {
    if (!hasWrittenHeaders) {
      res.status(200).set({
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      hasWrittenHeaders = true
    }
  }

  const writeContent = (content: string) => {
    res.write(content)
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
        options.onDelta(part.text, hasWrittenHeaders, writeHeaders, writeContent)
        continue
      }

      if (part.type === 'error') {
        const errMessage =
          part.error instanceof Error ? part.error.message : 'AI provider returned an error'
        if (!hasWrittenHeaders) {
          const fallbackText = await options.generateFallback(abortController.signal)
          if (fallbackText && options.onFallbackDone(fallbackText, writeHeaders, writeContent)) {
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
      if (fallbackText && options.onFallbackDone(fallbackText, writeHeaders, writeContent)) {
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
  input: ContinueStreamInput,
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
