import { describe, expect, test } from 'bun:test'
import {
  INLINE_AI_MAX_ZONE_CHOICES,
  parseInlineZoneWriteAction,
  type InlineZoneWriteAction,
} from '@plotline/shared'
import { buildInlineZoneWriteTools, hasValidToolScope } from './tools.js'

describe('buildInlineZoneWriteTools', () => {
  test('write_zone normalizes omitted offsets to a zero-width insert', async () => {
    const actions: InlineZoneWriteAction[] = []
    const tools = buildInlineZoneWriteTools({
      onWriteAction: (action) => {
        actions.push(action)
      },
    })
    const execute = tools.write_zone.execute as
      | ((input: { fromOffset?: number; toOffset?: number; content: string }) => Promise<{
          ok: boolean
          applied: InlineZoneWriteAction
        }>)
      | undefined
    expect(execute).toBeDefined()
    if (!execute) return

    const result = await execute({ content: 'alpha' })
    const applied = actions[0]
    expect(applied).toEqual({
      type: 'replace_range',
      fromOffset: 0,
      toOffset: 0,
      content: 'alpha',
    })

    expect(result).toEqual({
      ok: true,
      applied,
    })
  })

  test('write_zone_choices trims, deduplicates, and caps alternatives', async () => {
    const actions: InlineZoneWriteAction[] = []
    const tools = buildInlineZoneWriteTools({
      onWriteAction: (action) => {
        actions.push(action)
      },
    })
    const execute = tools.write_zone_choices.execute as
      | ((input: { choices: string[] }) => Promise<{ ok: boolean; applied: InlineZoneWriteAction }>)
      | undefined
    expect(execute).toBeDefined()
    if (!execute) return

    const rawChoices = Array.from({ length: INLINE_AI_MAX_ZONE_CHOICES + 3 }, (_, index) =>
      index % 2 === 0 ? `  Choice ${index % 4}  ` : `Choice ${index % 4}`
    )

    const result = await execute({ choices: rawChoices })
    const applied = actions[0]
    expect(applied?.type).toBe('set_choices')
    const appliedChoices = applied && applied.type === 'set_choices' ? applied.choices : []
    expect(appliedChoices.length).toBeLessThanOrEqual(INLINE_AI_MAX_ZONE_CHOICES)
    expect(appliedChoices).toEqual(['Choice 0', 'Choice 1', 'Choice 2', 'Choice 3'])
    expect(result).toEqual({
      ok: true,
      applied,
    })
  })
})

describe('parseInlineZoneWriteAction', () => {
  test('returns null for invalid offset ranges', () => {
    expect(
      parseInlineZoneWriteAction({
        type: 'replace_range',
        fromOffset: 8,
        toOffset: 3,
        content: 'bad',
      })
    ).toBeNull()
  })

  test('normalizes choices action payloads', () => {
    const parsed = parseInlineZoneWriteAction({
      type: 'set_choices',
      choices: ['  A  ', 'A', 'B', '', '  '],
    })

    expect(parsed).toEqual({
      type: 'set_choices',
      choices: ['A', 'B'],
    })
  })
})

describe('hasValidToolScope', () => {
  test('requires both project and document identifiers', () => {
    expect(hasValidToolScope({ projectId: 'a' })).toBe(false)
    expect(hasValidToolScope({ documentId: 'b' })).toBe(false)
    expect(hasValidToolScope({ projectId: 'a', documentId: 'b' })).toBe(true)
  })
})
