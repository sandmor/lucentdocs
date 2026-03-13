import { describe, expect, test } from 'bun:test'
import { DEFAULT_PERSISTED_CONFIG, editableConfigSchema } from './config.js'

describe('editableConfigSchema', () => {
  test('accepts values when excerpt budget is within context budget', () => {
    const result = editableConfigSchema.safeParse({
      ...DEFAULT_PERSISTED_CONFIG,
      maxContextChars: 10_000,
      maxPromptExcerptChars: 4_000,
    })

    expect(result.success).toBe(true)
  })

  test('rejects values when excerpt budget exceeds context budget', () => {
    const result = editableConfigSchema.safeParse({
      ...DEFAULT_PERSISTED_CONFIG,
      maxContextChars: 2_000,
      maxPromptExcerptChars: 3_000,
    })

    expect(result.success).toBe(false)
    if (result.success) return

    expect(result.error.issues[0]?.path).toEqual(['maxPromptExcerptChars'])
    expect(result.error.issues[0]?.message).toContain('less than or equal to maxContextChars')
  })
})
