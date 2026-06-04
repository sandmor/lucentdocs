export type AiProviderCustomHeaders = Record<string, string>

const MAX_CUSTOM_HEADERS = 20
const MAX_HEADER_KEY_LENGTH = 256
const MAX_HEADER_VALUE_LENGTH = 256
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCustomHeadersInput(input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) {
    return {}
  }

  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) return {}
    const parsed = JSON.parse(trimmed) as unknown
    if (!isPlainObject(parsed)) {
      throw new Error('Custom headers must be a JSON object.')
    }
    return parsed
  }

  if (!isPlainObject(input)) {
    throw new Error('Custom headers must be an object.')
  }

  return input
}

function normalizeHeaderName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Custom header names cannot be empty.')
  }
  if (trimmed.length > MAX_HEADER_KEY_LENGTH) {
    throw new Error(`Custom header name exceeds ${MAX_HEADER_KEY_LENGTH} characters.`)
  }
  if (!HEADER_NAME_PATTERN.test(trimmed)) {
    throw new Error(`Invalid custom header name "${trimmed}".`)
  }
  return trimmed
}

function normalizeHeaderValue(value: string): string {
  if (value.includes('\0')) {
    throw new Error('Custom header values cannot contain null bytes.')
  }
  if (value.length > MAX_HEADER_VALUE_LENGTH) {
    throw new Error(`Custom header value exceeds ${MAX_HEADER_VALUE_LENGTH} characters.`)
  }
  return value
}

export function normalizeCustomHeaders(input: unknown): AiProviderCustomHeaders {
  const parsed = parseCustomHeadersInput(input)
  const normalized: AiProviderCustomHeaders = {}

  for (const [rawKey, rawValue] of Object.entries(parsed)) {
    if (typeof rawValue !== 'string') {
      throw new Error(`Custom header "${rawKey}" must be a string value.`)
    }

    const key = normalizeHeaderName(rawKey)
    if (key in normalized) {
      throw new Error(`Duplicate custom header "${key}".`)
    }

    normalized[key] = normalizeHeaderValue(rawValue.trim())
  }

  if (Object.keys(normalized).length > MAX_CUSTOM_HEADERS) {
    throw new Error(`Custom headers cannot exceed ${MAX_CUSTOM_HEADERS} entries.`)
  }

  return normalized
}

export function mergeProviderRequestHeaders(
  defaults: Record<string, string>,
  custom: AiProviderCustomHeaders | undefined
): Record<string, string> {
  if (!custom || Object.keys(custom).length === 0) {
    return { ...defaults }
  }

  return {
    ...custom,
    ...defaults,
  }
}

export function fingerprintCustomHeaders(custom: AiProviderCustomHeaders | undefined): string {
  const normalized = normalizeCustomHeaders(custom ?? {})
  const entries = Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right))
  if (entries.length === 0) return 'none'
  return entries.map(([key, value]) => `${key}=${value}`).join('&')
}
