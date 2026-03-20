export interface DeferredBatchScheduler<TBatch> {
  schedule(batch: TBatch): void
}

export function createDeferredBatchScheduler<TBatch>(options: {
  merge: (queued: TBatch | null, incoming: TBatch) => TBatch
  isEmpty: (batch: TBatch) => boolean
  run: (batch: TBatch) => Promise<void>
  onError?: (error: unknown) => void
}): DeferredBatchScheduler<TBatch> {
  let queued: TBatch | null = null
  let scheduled = false
  let active = false

  const drain = async (): Promise<void> => {
    if (active) return
    active = true

    while (queued !== null) {
      const next = queued
      queued = null
      if (options.isEmpty(next)) continue

      try {
        await options.run(next)
      } catch (error) {
        options.onError?.(error)
      }
    }

    active = false
  }

  return {
    schedule(batch: TBatch): void {
      queued = options.merge(queued, batch)
      if (scheduled) return

      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        void drain()
      })
    },
  }
}
