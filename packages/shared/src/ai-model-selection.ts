import { z } from 'zod/v4'

export const AI_PROVIDER_SELECTION_USAGES = ['generation', 'embedding'] as const

export type AiProviderSelectionUsage = (typeof AI_PROVIDER_SELECTION_USAGES)[number]

export const AI_MODEL_SELECTION_SCOPE_TYPES = ['global', 'user', 'project', 'document'] as const

export type AiModelSelectionScopeType = (typeof AI_MODEL_SELECTION_SCOPE_TYPES)[number]

export interface ResolvedAiModelSelection {
  scopeType: AiModelSelectionScopeType
  scopeId: string
  providerConfigId: string
}

export type ResolvedEmbeddingModelSelection = ResolvedAiModelSelection

export const aiModelSelectionScopeTypeSchema = z.enum(AI_MODEL_SELECTION_SCOPE_TYPES)

export const resolvedAiModelSelectionSchema = z.object({
  scopeType: aiModelSelectionScopeTypeSchema,
  scopeId: z.string(),
  providerConfigId: z.string(),
}) satisfies z.ZodType<ResolvedAiModelSelection>
