import { describe, expect, test } from 'bun:test'
import { emitIncrementalChoices } from './ai-stream'

describe('emitIncrementalChoices', () => {
  test('emits new choices incrementally without duplicates', () => {
    const emittedIndexes = new Set<number>()
    const output: string[] = []

    emitIncrementalChoices(['Option A'], emittedIndexes, (choice) => {
      output.push(choice)
    })

    emitIncrementalChoices(['Option A', 'Option B', ''], emittedIndexes, (choice) => {
      output.push(choice)
    })

    emitIncrementalChoices(['Option A', 'Option B', 'Option C'], emittedIndexes, (choice) => {
      output.push(choice)
    })

    expect(output).toEqual(['Option A', 'Option B', 'Option C'])
    expect([...emittedIndexes]).toEqual([0, 1, 2])
  })
})
