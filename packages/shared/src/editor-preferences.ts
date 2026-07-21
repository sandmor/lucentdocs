import { z } from 'zod/v4'

export const QUOTE_STYLES = ['preserve', 'straight', 'smart'] as const
export type QuoteStyle = (typeof QUOTE_STYLES)[number]
export const quoteStyleSchema = z.enum(QUOTE_STYLES)
export const editorPreferencesSchema = z.object({
  singleQuoteStyle: quoteStyleSchema,
  doubleQuoteStyle: quoteStyleSchema,
})
export const editorPreferenceOverridesSchema = editorPreferencesSchema.partial()
export type EditorPreferences = z.infer<typeof editorPreferencesSchema>
export type EditorPreferenceOverrides = z.infer<typeof editorPreferenceOverridesSchema>
export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  singleQuoteStyle: 'smart',
  doubleQuoteStyle: 'smart',
}
