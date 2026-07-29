import { describe, expect, test } from 'bun:test'
import { LOCAL_DEFAULT_USER } from '../../core/models/user.js'
import type { InlineObserveEvent, InlineRuntime } from '../../inline/runtime.js'
import type { AppContext } from '../index.js'
import { inlineRouter } from './inline.js'

const input = {
  projectId: 'project_1',
  documentId: 'document_1',
  sessionId: 'session_1',
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function createContext(options: {
  getProject?: () => Promise<unknown>
  inlineRuntime: Pick<InlineRuntime, 'subscribe'>
}): AppContext {
  return {
    user: LOCAL_DEFAULT_USER,
    services: {
      projects: {
        getById:
          options.getProject ??
          (async () => ({
            id: input.projectId,
            ownerUserId: LOCAL_DEFAULT_USER.id,
          })),
      },
      documentSharing: {
        getEffectiveRole: async () => 'owner',
      },
      documents: {
        hasProjectAssociation: async () => true,
      },
    },
    inlineRuntime: options.inlineRuntime,
  } as unknown as AppContext
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (check()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for subscription setup')
}

describe('inlineRouter observeSession', () => {
  test('does not report an access failure after the observer unsubscribes', async () => {
    const access = deferred<unknown>()
    const errors: unknown[] = []
    const observable = await inlineRouter
      .createCaller(
        createContext({
          getProject: () => access.promise,
          inlineRuntime: {
            subscribe: async () => () => {},
          },
        })
      )
      .observeSession(input)

    const subscription = observable.subscribe({
      error: (error) => errors.push(error),
    })
    subscription.unsubscribe()

    access.reject(new Error('late access failure'))
    await flushPromises()

    expect(errors).toEqual([])
  })

  test('drops late runtime events and disposes a subscription that finishes after teardown', async () => {
    const initialization = deferred<() => void>()
    const received: InlineObserveEvent[] = []
    let runtimeListener: ((event: InlineObserveEvent) => void) | null = null
    let runtimeCleanupCalls = 0
    const observable = await inlineRouter
      .createCaller(
        createContext({
          inlineRuntime: {
            subscribe: async (_scope, listener) => {
              runtimeListener = listener
              return initialization.promise
            },
          },
        })
      )
      .observeSession(input)

    const subscription = observable.subscribe({
      next: (event) => received.push(event),
    })
    await waitFor(() => runtimeListener !== null)

    subscription.unsubscribe()
    const listener = runtimeListener as ((event: InlineObserveEvent) => void) | null
    listener?.({
      ...input,
      type: 'snapshot',
      seq: 1,
      deleted: false,
      generating: true,
      generationId: 'generation_1',
      draftText: 'late draft',
      draftKind: 'continuation',
      error: null,
      session: null,
    })
    initialization.resolve(() => {
      runtimeCleanupCalls += 1
    })
    await flushPromises()

    expect(received).toEqual([])
    expect(runtimeCleanupCalls).toBe(1)
  })
})
