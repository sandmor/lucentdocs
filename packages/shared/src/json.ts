type JsonPrimitive = string | number | boolean | null
type JsonArray = JsonValue[] | readonly JsonValue[]
export type JsonValue = JsonPrimitive | JsonObject | JsonArray
export type JsonObject = { [key: string]: JsonValue }

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true

  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return true
    case 'object':
      if (Array.isArray(value)) {
        return value.every((entry) => isJsonValue(entry))
      }

      return Object.values(value).every((entry) => isJsonValue(entry))
    default:
      return false
  }
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && isJsonValue(value)
}
