import { describe, expect, test } from 'bun:test'
import { emitIncrementalChoices, parseSelectionEditOutputFromText } from './ai-stream'

describe('emitIncrementalChoices', () => {
  test('emits new choices incrementally without duplicates', () => {
    const emittedChoicesByIndex = new Map<number, string>()
    const output: string[] = []

    emitIncrementalChoices(['Option A'], emittedChoicesByIndex, (choice) => {
      output.push(choice)
    })

    emitIncrementalChoices(['Option A', 'Option B', ''], emittedChoicesByIndex, (choice) => {
      output.push(choice)
    })

    emitIncrementalChoices(
      ['Option A', 'Option B', 'Option C'],
      emittedChoicesByIndex,
      (choice) => {
        output.push(choice)
      }
    )

    expect(output).toEqual(['Option A', 'Option B', 'Option C'])
    expect([...emittedChoicesByIndex.entries()]).toEqual([
      [0, 'Option A'],
      [1, 'Option B'],
      [2, 'Option C'],
    ])
  })

  test('deduplicates repeated choices emitted across multiple indexes in one batch', () => {
    const emittedChoicesByIndex = new Map<number, string>()
    const output: string[] = []

    emitIncrementalChoices(
      ['tong', 'tong', 'tong', 'tong', 'tong'],
      emittedChoicesByIndex,
      (choice) => {
        output.push(choice)
      }
    )

    expect(output).toEqual(['tong'])
  })

  test('emits updated choice text for the same index only when value changes', () => {
    const emittedChoicesByIndex = new Map<number, string>()
    const output: string[] = []

    emitIncrementalChoices(['tong'], emittedChoicesByIndex, (choice) => {
      output.push(choice)
    })

    emitIncrementalChoices(['tong'], emittedChoicesByIndex, (choice) => {
      output.push(choice)
    })

    emitIncrementalChoices(['tongue'], emittedChoicesByIndex, (choice) => {
      output.push(choice)
    })

    expect(output).toEqual(['tong', 'tongue'])
  })
})

describe('parseSelectionEditOutputFromText', () => {
  test('parses minimal insert JSON payload', () => {
    const parsed = parseSelectionEditOutputFromText(
      JSON.stringify({
        mode: 'insert',
        index: 4,
        content: 'inserted text',
      })
    )

    expect(parsed).toEqual({
      mode: 'insert',
      index: 4,
      content: 'inserted text',
    })
  })

  test('parses fenced JSON payload', () => {
    const parsed = parseSelectionEditOutputFromText(
      '```json\n{"mode":"choices","choices":["A","B"]}\n```'
    )

    expect(parsed).toEqual({
      mode: 'choices',
      choices: ['A', 'B'],
    })
  })

  test('returns null for non-JSON payload', () => {
    const parsed = parseSelectionEditOutputFromText('not json at all')
    expect(parsed).toBeNull()
  })
})
