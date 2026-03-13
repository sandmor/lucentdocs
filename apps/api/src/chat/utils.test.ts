import { describe, expect, test } from 'bun:test'
import { renderContextParts } from '@lucentdocs/shared'
import { toEditorContent } from '../testing/editor-content.js'
import { buildCurrentFileContext } from './utils.js'

describe('buildCurrentFileContext', () => {
  test('returns full content for small documents', () => {
    const content = toEditorContent('Small paragraph for chat context.')

    const result = buildCurrentFileContext(content, undefined, undefined)
    const text = renderContextParts(result)

    expect(text).toContain('Small paragraph for chat context.')
    expect(text).toContain('<caret />')
    expect(result.truncated).toBe(false)
    expect(text).not.toContain('<truncation_notice')
  })

  test('clips oversized documents to a local excerpt around the caret', () => {
    const unit = 'middle section '
    // The window is budget*2 chars wide; make the doc large enough to exceed it
    const repeated = unit.repeat(Math.ceil((12_000 * 4) / unit.length))
    const content = toEditorContent(`START MARKER\n\n${repeated}\n\nEND MARKER`)

    const result = buildCurrentFileContext(content, undefined, undefined)
    const text = renderContextParts(result)

    expect(result.truncated).toBe(true)
    expect(text).toContain('<truncation_notice')
    expect(text).toContain('<caret />')
    expect(text).toContain('END MARKER')
    expect(text).not.toContain('START MARKER')
    expect(text).toContain('<omitted content="earlier"/>')
  })
})
