import { z } from 'zod/v4'

export const INLINE_AI_MAX_ZONE_CHOICES = 8
export const INLINE_AI_DEFAULT_TOOL_STEP_LIMIT = 8

export interface InlineZoneReplaceAction {
  type: 'replace_range'
  fromOffset: number
  toOffset: number
  content: string
}

export interface InlineZoneChoicesAction {
  type: 'set_choices'
  choices: string[]
}

export type InlineZoneWriteAction = InlineZoneReplaceAction | InlineZoneChoicesAction

export const inlineZoneWriteToolInputSchema = z
  .object({
    fromOffset: z.number().int().min(0).optional(),
    toOffset: z.number().int().min(0).optional(),
    content: z.string(),
  })
  .superRefine((value, ctx) => {
    const fromOffset = value.fromOffset ?? 0
    const toOffset = value.toOffset ?? fromOffset
    if (toOffset < fromOffset) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toOffset'],
        message: 'toOffset must be greater than or equal to fromOffset',
      })
    }
  })

export const inlineZoneChoicesToolInputSchema = z.object({
  choices: z.array(z.string().trim().min(1)).min(1).max(INLINE_AI_MAX_ZONE_CHOICES),
})

export function normalizeInlineZoneChoices(choices: readonly string[]): string[] {
  return Array.from(new Set(choices.map((entry) => entry.trim())))
    .filter((entry) => entry.length > 0)
    .slice(0, INLINE_AI_MAX_ZONE_CHOICES)
}

export function parseInlineZoneWriteAction(value: unknown): InlineZoneWriteAction | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  if (record.type === 'replace_range') {
    const fromOffset = record.fromOffset
    const toOffset = record.toOffset
    const content = record.content
    if (
      !Number.isInteger(fromOffset) ||
      !Number.isInteger(toOffset) ||
      typeof content !== 'string' ||
      (fromOffset as number) < 0 ||
      (toOffset as number) < (fromOffset as number)
    ) {
      return null
    }

    return {
      type: 'replace_range',
      fromOffset: fromOffset as number,
      toOffset: toOffset as number,
      content,
    }
  }

  if (record.type === 'set_choices') {
    if (!Array.isArray(record.choices)) return null
    const normalizedChoices = normalizeInlineZoneChoices(
      record.choices.filter((entry): entry is string => typeof entry === 'string')
    )
    if (normalizedChoices.length === 0) return null
    return {
      type: 'set_choices',
      choices: normalizedChoices,
    }
  }

  return null
}
