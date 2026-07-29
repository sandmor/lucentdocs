import type { Observer } from '@trpc/server/observable'

type Cleanup = () => void

/**
 * Keeps an observable producer from notifying tRPC after its transport has
 * already torn down. Async subscription setup must register each cleanup as it
 * becomes available; a cleanup acquired after close is run immediately.
 */
export function createSubscriptionLifecycle<T>(
  observer: Observer<T, unknown>,
  signal?: AbortSignal
) {
  let closed = false
  const cleanups = new Set<Cleanup>()

  const runCleanup = (cleanup: Cleanup) => {
    try {
      cleanup()
    } catch (error) {
      console.error('tRPC subscription cleanup failed', error)
    }
  }

  const close = (): boolean => {
    if (closed) return false
    closed = true
    signal?.removeEventListener('abort', close)

    const pendingCleanups = [...cleanups]
    cleanups.clear()
    for (const cleanup of pendingCleanups) {
      runCleanup(cleanup)
    }
    return true
  }

  if (signal?.aborted) {
    close()
  } else {
    signal?.addEventListener('abort', close)
  }

  return {
    get closed() {
      return closed
    },
    addCleanup(cleanup: Cleanup): void {
      if (closed) {
        runCleanup(cleanup)
        return
      }
      cleanups.add(cleanup)
    },
    next(value: T): void {
      if (closed) return
      observer.next(value)
    },
    error(error: unknown): void {
      if (!close()) return
      observer.error(error)
    },
    close,
  }
}
