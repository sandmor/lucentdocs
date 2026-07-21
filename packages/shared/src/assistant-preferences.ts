import { z } from 'zod/v4'

export const ASSISTANT_MODES = ['ask', 'agent'] as const
export type AssistantMode = (typeof ASSISTANT_MODES)[number]
export const assistantModeSchema = z.enum(ASSISTANT_MODES)
export const assistantPreferencesSchema = z.object({ defaultMode: assistantModeSchema })
export const assistantPreferenceOverridesSchema = assistantPreferencesSchema.partial()
export type AssistantPreferences = z.infer<typeof assistantPreferencesSchema>
export type AssistantPreferenceOverrides = z.infer<typeof assistantPreferenceOverridesSchema>
export const DEFAULT_ASSISTANT_PREFERENCES: AssistantPreferences = { defaultMode: 'agent' }
