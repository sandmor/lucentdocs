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

export const selectionEditOutputSchema = z.object({
  mode: z.enum(['replace', 'insert', 'choices']),
  insertIndex: z.number().int().nullable(),
  content: z.string().nullable(),
  choices: z.array(z.string()).nullable(),
})

export type SelectionEditOutput = z.infer<typeof selectionEditOutputSchema>

export interface SelectionEditPartialOutput {
  mode?: AIMode | null
  insertIndex?: number | null
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

function toResponse(output: SelectionEditOutput): AIResponse {
  if (output.mode === 'replace') {
    return {
      mode: 'replace',
      content: output.content ?? '',
    }
  }

  if (output.mode === 'insert') {
    return {
      mode: 'insert',
      index: output.insertIndex ?? 0,
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

    const parsedInsertIndex = partial.insertIndex
    if (
      this.mode === 'insert' &&
      typeof parsedInsertIndex === 'number' &&
      Number.isInteger(parsedInsertIndex)
    ) {
      this.insertIndex = parsedInsertIndex
    }

    if (
      (this.mode === 'replace' || this.mode === 'insert') &&
      typeof partial.content === 'string'
    ) {
      this.content = partial.content
    }

    if (this.mode === 'choices' && Array.isArray(partial.choices)) {
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
