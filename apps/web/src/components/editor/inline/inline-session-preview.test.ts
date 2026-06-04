import { describe, expect, test } from 'bun:test'
import {
  areInlineSessionPreviewsEqual,
  type InlineSessionPreview,
} from './inline-session-preview'

describe('areInlineSessionPreviewsEqual', () => {
  const preview: InlineSessionPreview = {
    generationId: 'g1',
    assistantText: 'Hello',
    tools: [{ toolName: 'search', state: 'pending' }],
  }

  test('treats identical previews as equal', () => {
    expect(areInlineSessionPreviewsEqual(preview, { ...preview, tools: [...preview.tools] })).toBe(
      true
    )
  })

  test('detects text, tool, and generation changes', () => {
    expect(
      areInlineSessionPreviewsEqual(preview, { ...preview, assistantText: 'Changed' })
    ).toBe(false)
    expect(
      areInlineSessionPreviewsEqual(preview, {
        ...preview,
        tools: [{ toolName: 'search', state: 'complete' }],
      })
    ).toBe(false)
    expect(
      areInlineSessionPreviewsEqual(preview, { ...preview, generationId: 'g2' })
    ).toBe(false)
  })
})
