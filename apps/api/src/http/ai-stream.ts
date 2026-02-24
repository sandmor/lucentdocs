import express, { type Express } from 'express'
import { Output, generateText, streamText } from 'ai'
import { z } from 'zod/v4'
import {
  generate,
  generateStream,
  createStreamCleaner,
  cleanText,
  getLanguageModel,
} from '../ai/index.js'
import {
  ResponseParser,
  parseResponse,
  selectionEditOutputSchema,
  type AIMode,
  type SelectionEditOutput,
  type SelectionEditPartialOutput,
} from '../ai/response-parser.js'
import {
  assertPromptProtocolMode,
  resolveContinuePrompt,
  resolveSelectionPrompt,
} from '../ai/prompt-engine.js'
import { configManager } from '../config/manager.js'

interface AiStreamInput {
  mode: 'continue' | 'prompt'
  contextBefore: string
  contextAfter?: string
  hint?: string
  prompt?: string
  selectedText?: string
  maxOutputTokens?: number
}

export function emitIncrementalChoices(
  choices: string[],
  emittedChoicesByIndex: Map<number, string>,
  writeChoice: (choice: string) => void
): void {
  const seenInBatch = new Set<string>()

  for (let i = 0; i < choices.length; i += 1) {
    const choice = choices[i]?.trim()
    if (!choice) continue
    if (seenInBatch.has(choice)) continue
    if (emittedChoicesByIndex.get(i) === choice) continue

    writeChoice(choice)
    emittedChoicesByIndex.set(i, choice)
    seenInBatch.add(choice)
  }
}

function toCanonicalSelectionEditOutput(
  value: ReturnType<typeof parseResponse>
): SelectionEditOutput {
  if (!value) {
    return {
      mode: 'replace',
      insertIndex: null,
      index: null,
      content: '',
      choices: null,
    }
  }

  if (value.mode === 'replace') {
    return {
      mode: 'replace',
      insertIndex: null,
      index: null,
      content: value.content,
      choices: null,
    }
  }

  if (value.mode === 'insert') {
    return {
      mode: 'insert',
      insertIndex: value.index,
      index: value.index,
      content: value.content,
      choices: null,
    }
  }

  return {
    mode: 'choices',
    insertIndex: null,
    index: null,
    content: null,
    choices: value.choices,
  }
}

export function parseSelectionEditOutputFromText(text: string): SelectionEditOutput | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const candidates = new Set<string>([trimmed])

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) {
    candidates.add(fencedMatch[1].trim())
  }

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.add(trimmed.slice(firstBrace, lastBrace + 1).trim())
  }

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const parsed = JSON.parse(candidate) as unknown
      const structured = selectionEditOutputSchema.safeParse(parsed)
      if (structured.success) {
        return structured.data
      }

      const normalized = parseResponse(parsed)
      if (normalized) {
        return toCanonicalSelectionEditOutput(normalized)
      }
    } catch {
      continue
    }
  }

  return null
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
      selectedText: z.string().max(limits.contextChars).optional(),
      maxOutputTokens: z.number().int().min(64).max(4096).optional(),
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
    }) as z.ZodType<AiStreamInput>
}

export function registerAiTextStreamRoute(app: Express): void {
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
        selectedText
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
  selectedText: string | null
): Promise<void> {
  const rendered = resolveSelectionPrompt(
    input.contextBefore,
    contextAfter,
    input.prompt!.trim(),
    selectedText
  )
  assertPromptProtocolMode(rendered.definition, 'prompt')

  const cleaner = createStreamCleaner(input.contextBefore, contextAfter)
  const parser = new ResponseParser()
  let lastSentContentLength = 0
  const emittedChoicesByIndex = new Map<number, string>()
  const abortController = new AbortController()
  const abortIfClientDisconnected = () => {
    if (!res.writableEnded) abortController.abort()
  }
  req.on('aborted', abortIfClientDisconnected)
  res.on('close', abortIfClientDisconnected)

  let hasWrittenHeaders = false

  const writeHeaders = (mode: AIMode, insertIndex?: number) => {
    if (hasWrittenHeaders) return
    res.status(200).set({
      'Content-Type': 'application/jsonl; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-AI-Mode': mode,
    })
    if (insertIndex !== undefined) res.set('X-AI-Insert-Index', String(insertIndex))
    hasWrittenHeaders = true
  }

  const writeContent = (content: string) => {
    res.write(JSON.stringify(content) + '\n')
  }

  const writeChoice = (choice: string) => {
    res.write(JSON.stringify(choice) + '\n')
  }

  const flushParsedState = (parseResult: ReturnType<ResponseParser['feed']>): void => {
    if (!parseResult.mode) return
    if (!hasWrittenHeaders) {
      writeHeaders(parseResult.mode, parseResult.insertIndex ?? undefined)
    }

    if (parseResult.mode === 'replace' || parseResult.mode === 'insert') {
      const newContent = parseResult.content.slice(lastSentContentLength)
      if (!newContent) return

      const cleaned = cleaner.process(newContent)
      if (cleaned) writeContent(cleaned)
      lastSentContentLength = parseResult.content.length
      return
    }

    if (parseResult.isComplete) {
      emitIncrementalChoices(parseResult.choices, emittedChoicesByIndex, writeChoice)
    }
  }

  const resolveFallback = async (): Promise<boolean> => {
    const model = await getLanguageModel()
    let fallbackResult: ReturnType<ResponseParser['feedComplete']> | null = null

    try {
      const fallback = await generateText({
        model,
        system: rendered.systemPrompt,
        prompt: rendered.userPrompt,
        output: Output.object({ schema: selectionEditOutputSchema }),
        maxOutputTokens: input.maxOutputTokens ?? rendered.definition.defaults.maxOutputTokens,
        temperature: rendered.definition.defaults.temperature,
        abortSignal: abortController.signal,
      })

      fallbackResult = parser.feedComplete(fallback.output)
      if (!fallbackResult.mode) {
        const parsedFromText = parseSelectionEditOutputFromText(fallback.text)
        if (parsedFromText) {
          fallbackResult = parser.feedComplete(parsedFromText)
        }
      }
    } catch {
      const rawFallbackText = await generate({
        systemPrompt: rendered.systemPrompt,
        userPrompt: rendered.userPrompt,
        maxOutputTokens: input.maxOutputTokens ?? rendered.definition.defaults.maxOutputTokens,
        temperature: rendered.definition.defaults.temperature,
        abortSignal: abortController.signal,
      })
      const parsedFromText = parseSelectionEditOutputFromText(rawFallbackText)
      if (parsedFromText) {
        fallbackResult = parser.feedComplete(parsedFromText)
      }
    }

    if (!fallbackResult) return false
    if (!fallbackResult.mode) return false

    flushParsedState(fallbackResult)

    if (fallbackResult.mode === 'replace' || fallbackResult.mode === 'insert') {
      const tail = cleaner.flush()
      if (tail) writeContent(tail)
    }

    return true
  }

  try {
    const model = await getLanguageModel()
    const result = streamText({
      model,
      system: rendered.systemPrompt,
      prompt: rendered.userPrompt,
      output: Output.object({ schema: selectionEditOutputSchema }),
      maxOutputTokens: input.maxOutputTokens ?? rendered.definition.defaults.maxOutputTokens,
      temperature: rendered.definition.defaults.temperature,
      abortSignal: abortController.signal,
      onError: ({ error }) => {
        console.error('AI prompt structured stream error', error)
      },
    })

    for await (const partialObject of result.partialOutputStream) {
      const parseResult = parser.feed(partialObject as SelectionEditPartialOutput)
      flushParsedState(parseResult)
    }

    const finalOutput = await result.output
    const finalResult = parser.feedComplete(finalOutput)
    flushParsedState(finalResult)

    if (!hasWrittenHeaders) {
      const fallbackResolved = await resolveFallback()
      if (!fallbackResolved) {
        res.status(502).json({ message: 'AI stream finished without structured output' })
        return
      }
      res.end()
      return
    }

    if (finalResult.mode === 'replace' || finalResult.mode === 'insert') {
      const tail = cleaner.flush()
      if (tail) writeContent(tail)
    }

    res.end()
  } catch (error: unknown) {
    if (abortController.signal.aborted) {
      if (!res.headersSent) res.end()
      return
    }

    console.error('AI prompt stream failed', error)

    if (!hasWrittenHeaders) {
      try {
        const fallbackResolved = await resolveFallback()
        if (fallbackResolved) {
          res.end()
          return
        }
      } catch (fallbackError) {
        console.error('AI prompt fallback failed', fallbackError)
      }

      const message =
        error instanceof Error ? error.message : 'Failed to generate structured prompt stream'
      res.status(500).json({ message })
      return
    }

    res.end()
  }
}
