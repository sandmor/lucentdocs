import { z } from 'zod/v4'
import type { JsonObject, JsonValue } from './json.js'

export const INDEXING_STRATEGY_SCOPE_TYPES = ['global', 'user', 'project', 'document'] as const

export type IndexingStrategyScopeType = (typeof INDEXING_STRATEGY_SCOPE_TYPES)[number]

export const INDEXING_STRATEGY_TYPES = ['whole_document', 'sliding_window'] as const

export type IndexingStrategyType = (typeof INDEXING_STRATEGY_TYPES)[number]

export const SLIDING_WINDOW_LEVELS = ['character', 'sentence', 'paragraph'] as const

export type SlidingWindowLevel = (typeof SLIDING_WINDOW_LEVELS)[number]

export interface WholeDocumentIndexingStrategy {
  type: 'whole_document'
  properties: JsonObject
}

export interface CharacterSlidingWindowProperties extends JsonObject {
  level: 'character'
  windowSize: number
  stride: number
}

export interface SentenceSlidingWindowProperties extends JsonObject {
  level: 'sentence'
  windowSize: number
  stride: number
  minUnitChars: number
  maxUnitChars: number
}

export interface ParagraphSlidingWindowProperties extends JsonObject {
  level: 'paragraph'
  windowSize: number
  stride: number
  minUnitChars: number
  maxUnitChars: number
}

export type SlidingWindowIndexingStrategyProperties =
  | CharacterSlidingWindowProperties
  | SentenceSlidingWindowProperties
  | ParagraphSlidingWindowProperties

export interface SlidingWindowIndexingStrategy {
  type: 'sliding_window'
  properties: SlidingWindowIndexingStrategyProperties
}

export type IndexingStrategy = WholeDocumentIndexingStrategy | SlidingWindowIndexingStrategy

export interface ResolvedIndexingStrategy {
  scopeType: IndexingStrategyScopeType
  scopeId: string
  strategy: IndexingStrategy
}

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    jsonObjectSchema,
  ])
)

const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema)

const characterSlidingWindowPropertiesSchema = z
  .object({
    level: z.literal('character'),
    windowSize: z.number().int().min(1).max(200_000),
    stride: z.number().int().min(1).max(200_000),
  })
  .passthrough()

const sentenceSlidingWindowPropertiesSchema = z
  .object({
    level: z.literal('sentence'),
    windowSize: z.number().int().min(1).max(200_000),
    stride: z.number().int().min(1).max(200_000),
    minUnitChars: z.number().int().min(1).max(200_000),
    maxUnitChars: z.number().int().min(1).max(200_000),
  })
  .passthrough()

const paragraphSlidingWindowPropertiesSchema = z
  .object({
    level: z.literal('paragraph'),
    windowSize: z.number().int().min(1).max(200_000),
    stride: z.number().int().min(1).max(200_000),
    minUnitChars: z.number().int().min(1).max(200_000),
    maxUnitChars: z.number().int().min(1).max(200_000),
  })
  .passthrough()

const slidingWindowPropertiesSchema = z
  .discriminatedUnion('level', [
    characterSlidingWindowPropertiesSchema,
    sentenceSlidingWindowPropertiesSchema,
    paragraphSlidingWindowPropertiesSchema,
  ])
  .superRefine((value, ctx) => {
    if (value.stride > value.windowSize) {
      ctx.addIssue({
        code: 'custom',
        message: 'Stride must be less than or equal to window size.',
        path: ['stride'],
      })
      return
    }

    if (value.level !== 'character' && value.minUnitChars > value.maxUnitChars) {
      ctx.addIssue({
        code: 'custom',
        message: 'Minimum length must be less than or equal to maximum length.',
        path: ['minUnitChars'],
      })
    }
  }) as z.ZodType<SlidingWindowIndexingStrategyProperties>

export const indexingStrategySchema: z.ZodType<IndexingStrategy> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('whole_document'),
    properties: jsonObjectSchema.default({}),
  }),
  z.object({
    type: z.literal('sliding_window'),
    properties: slidingWindowPropertiesSchema,
  }),
])

export const nullableIndexingStrategySchema = indexingStrategySchema.nullable()

export const indexingStrategyScopeTypeSchema = z.enum(INDEXING_STRATEGY_SCOPE_TYPES)

export const DEFAULT_GLOBAL_INDEXING_STRATEGY: IndexingStrategy = Object.freeze({
  type: 'sliding_window',
  properties: Object.freeze({
    level: 'paragraph',
    windowSize: 3,
    stride: 2,
    minUnitChars: 300,
    maxUnitChars: 2000,
  }),
}) as IndexingStrategy

export function describeIndexingStrategy(strategy: IndexingStrategy): string {
  if (strategy.type === 'whole_document') {
    return 'Whole document'
  }

  if (strategy.properties.level === 'character') {
    return `Sliding window (character ${strategy.properties.windowSize}/${strategy.properties.stride})`
  }

  return `Sliding window (${strategy.properties.level} ${strategy.properties.windowSize}/${strategy.properties.stride}, ${strategy.properties.minUnitChars}-${strategy.properties.maxUnitChars} chars)`
}
