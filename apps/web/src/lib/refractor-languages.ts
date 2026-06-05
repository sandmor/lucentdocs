import { refractor } from 'refractor/core'
import { normalizeLanguage, PLAIN_LANGUAGE } from '@/lib/code-block-language-id'
import { REFRACTOR_LANGUAGE_IDS } from '@/lib/refractor-language-manifest'
import { refractorGrammarLoaders } from '@/lib/refractor-language-loaders.generated'

export const AVAILABLE_LANGUAGES: readonly string[] = [...REFRACTOR_LANGUAGE_IDS]

const availableLanguageSet = new Set<string>(REFRACTOR_LANGUAGE_IDS)

const loadPromises = new Map<string, Promise<boolean>>()

async function importGrammar(language: string) {
  const loader = refractorGrammarLoaders[language]
  if (!loader) {
    throw new Error(`No refractor loader for language: ${language}`)
  }
  return loader()
}

export function isAvailableLanguage(language: string | null | undefined): boolean {
  if (!language?.trim()) return false
  const normalized = normalizeLanguage(language)
  if (normalized === PLAIN_LANGUAGE) return false
  return availableLanguageSet.has(normalized)
}

export async function ensureLanguageLoaded(language: string | null | undefined): Promise<boolean> {
  if (!language?.trim()) return false

  const normalized = normalizeLanguage(language)
  if (normalized === PLAIN_LANGUAGE) return false
  if (refractor.registered(normalized)) return true
  if (!availableLanguageSet.has(normalized)) return false

  const existing = loadPromises.get(normalized)
  if (existing) return existing

  const promise = importGrammar(normalized)
    .then((syntax) => {
      refractor.register(syntax)
      return refractor.registered(normalized)
    })
    .catch((error) => {
      console.warn(`Failed to load refractor grammar for ${normalized}:`, error)
      return false
    })
    .finally(() => {
      loadPromises.delete(normalized)
    })

  loadPromises.set(normalized, promise)
  return promise
}

export { refractor }
