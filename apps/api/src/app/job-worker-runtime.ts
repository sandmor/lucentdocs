import { nanoid } from 'nanoid'
import type { JobQueuePort, QueueJobEnvelope } from '../core/ports/jobQueue.port.js'

export type JobHandler = (job: QueueJobEnvelope<unknown>) => Promise<void>
export type JobBatchHandler = (jobs: QueueJobEnvelope<unknown>[]) => Promise<void>

/**
 * `single`: handle each leased envelope independently.
 * `batch`: the worker groups leased envelopes by type and invokes one handler call per type.
 */
export type JobHandlerRegistration =
  | JobHandler
  | { mode?: 'single'; handle: JobHandler }
  | { mode: 'batch'; handle: JobBatchHandler }

interface NormalizedHandlerRegistration {
  mode: 'single' | 'batch'
  handle: JobHandler | JobBatchHandler
}

export interface JobWorkerRuntimeOptions {
  queue: JobQueuePort
  handlers: Record<string, JobHandlerRegistration>
  leaseDurationMs?: number
  leaseBatchSize?: number
  maxIdleWaitMs?: number
  retryBaseDelayMs?: number
  retryMaxDelayMs?: number
  now?: () => number
}

const DEFAULT_LEASE_DURATION_MS = 30_000
const DEFAULT_LEASE_BATCH_SIZE = 8
const DEFAULT_MAX_IDLE_WAIT_MS = 30_000
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000
const DEFAULT_RETRY_MAX_DELAY_MS = 30_000

export class JobWorkerRuntime {
  #queue: JobQueuePort
  #handlers: Record<string, NormalizedHandlerRegistration>
  #leaseDurationMs: number
  #leaseBatchSize: number
  #maxIdleWaitMs: number
  #retryBaseDelayMs: number
  #retryMaxDelayMs: number
  #now: () => number
  #running = false
  #workerId = `worker_${nanoid()}`
  #tickInFlight: Promise<void> | null = null
  #loopInFlight: Promise<void> | null = null
  #waitAbortController: AbortController | null = null

  constructor(options: JobWorkerRuntimeOptions) {
    this.#queue = options.queue
    this.#handlers = Object.fromEntries(
      Object.entries(options.handlers).map(([type, registration]) => [
        type,
        normalizeHandlerRegistration(registration),
      ])
    )
    this.#leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS
    this.#leaseBatchSize = options.leaseBatchSize ?? DEFAULT_LEASE_BATCH_SIZE
    this.#maxIdleWaitMs = options.maxIdleWaitMs ?? DEFAULT_MAX_IDLE_WAIT_MS
    this.#retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS
    this.#retryMaxDelayMs = options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS
    this.#now = options.now ?? Date.now
  }

  start(): void {
    if (this.#running) return
    this.#running = true
    this.#waitAbortController = new AbortController()
    this.#loopInFlight = this.#runLoop().finally(() => {
      this.#loopInFlight = null
    })
  }

  async stop(): Promise<void> {
    this.#running = false
    if (this.#waitAbortController) {
      this.#waitAbortController.abort()
      this.#waitAbortController = null
    }

    if (this.#loopInFlight) {
      await this.#loopInFlight
    }
  }

  async #runLoop(): Promise<void> {
    while (this.#running) {
      await this.tickOnce()
      if (!this.#running) break

      await this.#queue.waitForAvailable({
        now: this.#now(),
        timeoutMs: this.#maxIdleWaitMs,
        types: Object.keys(this.#handlers),
        signal: this.#waitAbortController?.signal,
      })
    }
  }

  async tickOnce(): Promise<void> {
    if (!this.#running) return
    if (this.#tickInFlight) {
      await this.#tickInFlight
      return
    }

    this.#tickInFlight = this.#runTick().finally(() => {
      this.#tickInFlight = null
    })
    await this.#tickInFlight
  }

  async #runTick(): Promise<void> {
    const now = this.#now()
    const jobs = await this.#queue.lease({
      workerId: this.#workerId,
      now,
      leaseDurationMs: this.#leaseDurationMs,
      limit: this.#leaseBatchSize,
      types: Object.keys(this.#handlers),
    })

    if (jobs.length === 0) return

    // Batch-capable handlers receive all leased envelopes for their type in this tick.
    const jobsByType = new Map<string, QueueJobEnvelope<unknown>[]>()
    for (const job of jobs) {
      const grouped = jobsByType.get(job.type)
      if (grouped) {
        grouped.push(job)
      } else {
        jobsByType.set(job.type, [job])
      }
    }

    for (const [jobType, typedJobs] of jobsByType) {
      const registration = this.#handlers[jobType]
      if (!registration) {
        await Promise.all(
          typedJobs.map((job) =>
            this.#failJob(job, new Error(`No handler registered for job type ${job.type}`), 0)
          )
        )
        continue
      }

      if (registration.mode === 'batch') {
        try {
          await (registration.handle as JobBatchHandler)(typedJobs)
          await Promise.all(typedJobs.map((job) => this.#completeJob(job)))
        } catch (error) {
          await Promise.all(typedJobs.map((job) => this.#failJob(job, error)))
        }
        continue
      }

      const singleHandler = registration.handle as JobHandler
      for (const job of typedJobs) {
        try {
          await singleHandler(job)
          await this.#completeJob(job)
        } catch (error) {
          await this.#failJob(job, error)
        }
      }
    }
  }

  async #completeJob(job: QueueJobEnvelope<unknown>): Promise<void> {
    await this.#queue.complete({
      id: job.id,
      workerId: this.#workerId,
      expectedUpdatedAt: job.updatedAt,
    })
  }

  async #failJob(
    job: QueueJobEnvelope<unknown>,
    error: unknown,
    explicitRetryDelayMs?: number
  ): Promise<void> {
    const retryDelayMs =
      explicitRetryDelayMs ??
      Math.min(
        this.#retryMaxDelayMs,
        this.#retryBaseDelayMs * 2 ** Math.min(10, Math.max(0, Math.max(1, job.attempt) - 1))
      )

    await this.#queue.fail({
      id: job.id,
      workerId: this.#workerId,
      now: this.#now(),
      error: error instanceof Error ? error.message : String(error),
      retryDelayMs,
    })
  }
}

function normalizeHandlerRegistration(
  registration: JobHandlerRegistration
): NormalizedHandlerRegistration {
  if (typeof registration === 'function') {
    return { mode: 'single', handle: registration }
  }

  if (registration.mode === 'batch') {
    return { mode: 'batch', handle: registration.handle }
  }

  return { mode: 'single', handle: registration.handle }
}

export function createJobWorkerRuntime(options: JobWorkerRuntimeOptions): JobWorkerRuntime {
  return new JobWorkerRuntime(options)
}
