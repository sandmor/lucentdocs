type GenerationWaiter = {
  resolve: () => void
  reject: (error: Error) => void
}

const waiters = new Map<string, GenerationWaiter>()

function waiterKey(sessionId: string, generationId: string): string {
  return `${sessionId}:${generationId}`
}

export function waitForInlineGeneration(
  sessionId: string,
  generationId: string,
  signal?: AbortSignal
): Promise<void> {
  const key = waiterKey(sessionId, generationId)
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const abortError = new Error('Inline generation aborted')
      abortError.name = 'AbortError'
      reject(abortError)
      return
    }

    waiters.set(key, { resolve, reject })

    signal?.addEventListener(
      'abort',
      () => {
        waiters.delete(key)
        const abortError = new Error('Inline generation aborted')
        abortError.name = 'AbortError'
        reject(abortError)
      },
      { once: true }
    )
  })
}

export function settleInlineGenerationWait(
  sessionId: string,
  generationId: string,
  options: { error?: string } = {}
): void {
  const key = waiterKey(sessionId, generationId)
  const waiter = waiters.get(key)
  if (!waiter) return
  waiters.delete(key)

  if (options.error) {
    waiter.reject(new Error(options.error))
    return
  }
  waiter.resolve()
}

/** Settles any in-flight wait for the session (used when the server clears generationId). */
export function settleInlineGenerationWaitsForSession(
  sessionId: string,
  options: { error?: string } = {}
): void {
  const prefix = `${sessionId}:`
  for (const [key, waiter] of [...waiters.entries()]) {
    if (!key.startsWith(prefix)) continue
    waiters.delete(key)
    if (options.error) {
      waiter.reject(new Error(options.error))
    } else {
      waiter.resolve()
    }
  }
}
