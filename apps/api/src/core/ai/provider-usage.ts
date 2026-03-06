export const AI_PROVIDER_USAGES = ['generation', 'embedding'] as const

export type AiProviderUsage = (typeof AI_PROVIDER_USAGES)[number]
