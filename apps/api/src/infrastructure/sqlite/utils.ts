import { isJsonObject, type JsonObject } from '@lucentdocs/shared'

export function toJsonField(value: JsonObject | null): string | null {
  return value ? JSON.stringify(value) : null
}

export function fromJsonField(value: string | null): JsonObject | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return isJsonObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function toOptionalJsonField(
  value: JsonObject | null | undefined
): string | null | undefined {
  if (value === undefined) return undefined
  return value ? JSON.stringify(value) : null
}
