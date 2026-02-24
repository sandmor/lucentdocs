import { z } from 'zod/v4'

export type AIMode = 'replace' | 'insert' | 'choices'

export interface ReplaceResponse {
  mode: 'replace'
  content: string
}

export interface InsertResponse {
  mode: 'insert'
  index: number
  content: string
}

export interface ChoicesResponse {
  mode: 'choices'
  choices: string[]
}

export type AIResponse = ReplaceResponse | InsertResponse | ChoicesResponse

const replaceOutputSchema = z.object({
  mode: z.literal('replace'),
  insertIndex: z.number().int().nullable().optional(),
  index: z.number().int().nullable().optional(),
  content: z.string(),
  choices: z.array(z.string()).nullable().optional(),
})

const insertOutputSchema = z.object({
  mode: z.literal('insert'),
  insertIndex: z.number().int().nullable().optional(),
  index: z.number().int().nullable().optional(),
  content: z.string(),
  choices: z.array(z.string()).nullable().optional(),
})

const choicesOutputSchema = z.object({
  mode: z.literal('choices'),
  insertIndex: z.number().int().nullable().optional(),
  index: z.number().int().nullable().optional(),
  content: z.string().nullable().optional(),
  choices: z.array(z.string()),
})

export const selectionEditOutputSchema = z.discriminatedUnion('mode', [
  replaceOutputSchema,
  insertOutputSchema,
  choicesOutputSchema,
])

export type SelectionEditOutput = z.infer<typeof selectionEditOutputSchema>

export interface SelectionEditPartialOutput {
  mode?: AIMode | null
  insertIndex?: number | null
  index?: number | null
  content?: string | null
  choices?: Array<string | null | undefined> | null
}

export interface StreamingParserResult {
  mode: AIMode | null
  insertIndex: number | null
  content: string
  choices: string[]
  isComplete: boolean
}

function parseMode(value: unknown): AIMode | null {
  if (value === 'replace' || value === 'insert' || value === 'choices') return value
  return null
}

function parseInsertIndex(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  return value
}

function toResponse(output: SelectionEditOutput): AIResponse {
  const normalizedInsertIndex =
    parseInsertIndex(output.insertIndex) ?? parseInsertIndex(output.index) ?? 0

  if (output.mode === 'replace') {
    return {
      mode: 'replace',
      content: output.content ?? '',
    }
  }

  if (output.mode === 'insert') {
    return {
      mode: 'insert',
      index: normalizedInsertIndex,
      content: output.content ?? '',
    }
  }

  return {
    mode: 'choices',
    choices: output.choices ?? [],
  }
}

export class ResponseParser {
  private mode: AIMode | null = null
  private insertIndex: number | null = null
  private content = ''
  private choices: string[] = []
  private complete = false

  private snapshot(): StreamingParserResult {
    return {
      mode: this.mode,
      insertIndex: this.insertIndex,
      content: this.content,
      choices: this.choices,
      isComplete: this.complete,
    }
  }

  feed(partial: SelectionEditPartialOutput | null | undefined): StreamingParserResult {
    if (!partial) return this.snapshot()

    const nextMode = parseMode(partial.mode)
    if (!this.mode && nextMode) {
      this.mode = nextMode
    }

    const parsedInsertIndex =
      parseInsertIndex(partial.insertIndex) ?? parseInsertIndex(partial.index)
    if (typeof parsedInsertIndex === 'number') {
      this.insertIndex = parsedInsertIndex
    }

    if (typeof partial.content === 'string') {
      this.content = partial.content
    }

    if (Array.isArray(partial.choices)) {
      this.choices = partial.choices.filter((entry): entry is string => typeof entry === 'string')
    }

    return this.snapshot()
  }

  feedComplete(output: unknown): StreamingParserResult {
    const parsed = selectionEditOutputSchema.safeParse(output)
    if (!parsed.success) return this.snapshot()

    const normalized = toResponse(parsed.data)
    this.complete = true

    if (normalized.mode === 'replace') {
      this.mode = 'replace'
      this.insertIndex = null
      this.content = normalized.content
      this.choices = []
      return this.snapshot()
    }

    if (normalized.mode === 'insert') {
      this.mode = 'insert'
      this.insertIndex = normalized.index
      this.content = normalized.content
      this.choices = []
      return this.snapshot()
    }

    this.mode = 'choices'
    this.insertIndex = null
    this.content = ''
    this.choices = normalized.choices
    return this.snapshot()
  }

  finalize(): AIResponse | null {
    if (!this.mode) return null

    if (this.mode === 'replace') {
      return {
        mode: 'replace',
        content: this.content,
      }
    }

    if (this.mode === 'insert') {
      return {
        mode: 'insert',
        index: this.insertIndex ?? 0,
        content: this.content,
      }
    }

    return {
      mode: 'choices',
      choices: this.choices,
    }
  }
}

export function parseResponse(output: unknown): AIResponse | null {
  const parsedCanonical = selectionEditOutputSchema.safeParse(output)
  if (parsedCanonical.success) return toResponse(parsedCanonical.data)
  return null
}
