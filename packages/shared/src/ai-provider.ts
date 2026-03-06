import type { AiModelSourceType } from './config.js'

export const AI_PROVIDER_DEFAULT_BASE_URLS: Readonly<Record<AiModelSourceType, string>> =
  Object.freeze({
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    openrouter: 'https://openrouter.ai/api/v1',
  })

export interface ParsedBaseURLResult {
  ok: boolean
  value?: string
  error?: string
}

export function normalizeModelSourceType(value: string): AiModelSourceType {
  if (value === 'anthropic') return 'anthropic'
  if (value === 'openrouter') return 'openrouter'
  return 'openai'
}

export function normalizeBaseURL(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const normalized = trimmed.replace(/\/+$/, '')
  return normalized || trimmed
}

export function isSameBaseURL(left: string, right: string): boolean {
  return normalizeBaseURL(left) === normalizeBaseURL(right)
}

export function parseAndNormalizeHttpBaseURL(value: string): ParsedBaseURLResult {
  const trimmed = value.trim()
  if (!trimmed) {
    return {
      ok: false,
      error: 'Base URL is required.',
    }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return {
      ok: false,
      error: 'Base URL must be a valid URL.',
    }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: 'Base URL must use http:// or https://.',
    }
  }

  const pathname = parsed.pathname.replace(/\/+$/, '')
  const normalized = `${parsed.origin}${pathname}`

  return {
    ok: true,
    value: normalizeBaseURL(normalized),
  }
}

export function normalizeProviderBaseURL(
  type: AiModelSourceType,
  value: string
): ParsedBaseURLResult {
  const trimmed = value.trim()
  if (!trimmed) {
    return {
      ok: true,
      value: AI_PROVIDER_DEFAULT_BASE_URLS[type],
    }
  }
  return parseAndNormalizeHttpBaseURL(trimmed)
}
