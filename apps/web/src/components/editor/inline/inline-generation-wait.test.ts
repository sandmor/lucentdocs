import { describe, expect, test } from 'bun:test'
import {
  settleInlineGenerationWait,
  settleInlineGenerationWaitsForSession,
  waitForInlineGeneration,
} from './inline-generation-wait'

describe('inline-generation-wait', () => {
  test('resolves when the matching generation is settled', async () => {
    const pending = waitForInlineGeneration('session-a', 'gen-1')
    settleInlineGenerationWait('session-a', 'gen-1')
    await expect(pending).resolves.toBeUndefined()
  })

  test('settles all waiters for a session when the server clears generationId', async () => {
    const first = waitForInlineGeneration('session-b', 'gen-1')
    const second = waitForInlineGeneration('session-b', 'gen-2')
    settleInlineGenerationWaitsForSession('session-b')
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
  })

  test('rejects when the abort signal fires', async () => {
    const controller = new AbortController()
    const pending = waitForInlineGeneration('session-c', 'gen-1', controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('rejects with an error when settlement includes one', async () => {
    const pending = waitForInlineGeneration('session-d', 'gen-1')
    settleInlineGenerationWait('session-d', 'gen-1', { error: 'stream failed' })
    await expect(pending).rejects.toThrow('stream failed')
  })
})
