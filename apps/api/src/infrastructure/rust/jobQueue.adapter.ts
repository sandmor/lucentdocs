import type { NativeStorageEngine } from '@lucentdocs/core'
import type {
  CompleteLeasedJobInput,
  CompleteLeasedJobResult,
  EnqueueJobInput,
  FailLeasedJobInput,
  JobQueuePort,
  JobQueueTypeStats,
  LeaseJobsInput,
  QueueJobEnvelope,
  WaitForAvailableJobsInput,
  WaitForAvailableJobsResult,
  UpsertUniqueJobInput,
} from '../../core/ports/jobQueue.port.js'
import type { TransactionPort } from '../../core/ports/transaction.port.js'
import { currentTxId } from './tx-scope.js'
import { enqueueJobToDto, queueJobFromDto, upsertUniqueJobToDto } from './mappers.js'

function normalizeAttempts(maxAttempts: number | undefined): number {
  if (maxAttempts === undefined) return 8
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error('maxAttempts must be a positive integer.')
  }
  return maxAttempts
}

function normalizePriority(priority: number | undefined): number {
  if (priority === undefined) return 0
  if (!Number.isInteger(priority)) {
    throw new Error('priority must be an integer.')
  }
  return priority
}

export class RustJobQueueAdapter implements JobQueuePort {
  constructor(
    private engine: NativeStorageEngine,
    private transaction: TransactionPort
  ) {}

  async enqueue<TPayload>(input: EnqueueJobInput<TPayload>): Promise<QueueJobEnvelope<TPayload>> {
    const dto = enqueueJobToDto({
      ...input,
      maxAttempts: normalizeAttempts(input.maxAttempts),
      priority: normalizePriority(input.priority),
    })
    const row = await this.engine.jobQueueEnqueue(currentTxId(), dto)
    return queueJobFromDto(row)
  }

  async upsertUnique<TPayload>(
    input: UpsertUniqueJobInput<TPayload>
  ): Promise<QueueJobEnvelope<TPayload>> {
    const dto = upsertUniqueJobToDto({
      ...input,
      maxAttempts: normalizeAttempts(input.maxAttempts),
      priority: normalizePriority(input.priority),
    })

    const row = await this.transaction.run(async () => {
      return this.engine.jobQueueUpsertUnique(currentTxId(), dto)
    })

    return queueJobFromDto(row)
  }

  async lease(input: LeaseJobsInput): Promise<Array<QueueJobEnvelope<unknown>>> {
    if (input.limit <= 0) return []

    const rows = await this.transaction.run(async () => {
      return this.engine.jobQueueLease(currentTxId(), {
        workerId: input.workerId,
        now: input.now,
        leaseDurationMs: input.leaseDurationMs,
        limit: input.limit,
        typesJson:
          input.types && input.types.length > 0 ? JSON.stringify(input.types) : undefined,
      })
    })

    return rows.map((row) => queueJobFromDto(row))
  }

  async complete(input: CompleteLeasedJobInput): Promise<CompleteLeasedJobResult> {
    const result = await this.transaction.run(async () => {
      return this.engine.jobQueueComplete(currentTxId(), {
        id: input.id,
        workerId: input.workerId,
        expectedUpdatedAt: input.expectedUpdatedAt,
      })
    })

    return result as CompleteLeasedJobResult
  }

  async fail(input: FailLeasedJobInput): Promise<'retrying' | 'dead' | 'missing'> {
    const result = await this.transaction.run(async () => {
      return this.engine.jobQueueFail(currentTxId(), {
        id: input.id,
        workerId: input.workerId,
        now: input.now,
        error: input.error,
        retryDelayMs: input.retryDelayMs,
      })
    })

    return result as 'retrying' | 'dead' | 'missing'
  }

  async getByTypeAndDedupeKey<TPayload>(
    type: string,
    dedupeKey: string
  ): Promise<QueueJobEnvelope<TPayload> | undefined> {
    const row = await this.engine.jobQueueGetByTypeAndDedupeKey(currentTxId(), type, dedupeKey)
    return row ? queueJobFromDto(row) : undefined
  }

  async getByTypeAndDedupeKeys<TPayload>(
    type: string,
    dedupeKeys: string[]
  ): Promise<Array<QueueJobEnvelope<TPayload>>> {
    if (dedupeKeys.length === 0) return []

    const rows = await this.engine.jobQueueGetByTypeAndDedupeKeys(
      currentTxId(),
      type,
      dedupeKeys
    )
    return rows.map((row) => queueJobFromDto<TPayload>(row))
  }

  async listQueuedByType<TPayload>(type: string): Promise<Array<QueueJobEnvelope<TPayload>>> {
    const rows = await this.engine.jobQueueListQueuedByType(currentTxId(), type)
    return rows.map((row) => queueJobFromDto<TPayload>(row))
  }

  async deleteQueuedByTypeAndDedupeKeys(type: string, dedupeKeys: string[]): Promise<void> {
    if (dedupeKeys.length === 0) return
    await this.engine.jobQueueDeleteQueuedByTypeAndDedupeKeys(currentTxId(), type, dedupeKeys)
  }

  async getTypeStats(type: string): Promise<JobQueueTypeStats> {
    const stats = await this.engine.jobQueueGetTypeStats(currentTxId(), type)
    return {
      totalQueued: stats.totalQueued,
      nextAvailableAt: stats.nextAvailableAt ?? null,
      oldestQueuedAt: stats.oldestQueuedAt ?? null,
    }
  }

  async waitForAvailable(input: WaitForAvailableJobsInput): Promise<WaitForAvailableJobsResult> {
    if (input.signal?.aborted) {
      return { reason: 'aborted' }
    }

    if (input.timeoutMs <= 0) {
      return { reason: 'timeout' }
    }

    const typesJson =
      input.types && input.types.length > 0 ? JSON.stringify(input.types) : undefined

    const waitPromise = this.engine.jobQueueWaitForAvailable(
      currentTxId(),
      input.now,
      input.timeoutMs,
      typesJson
    )

    if (!input.signal) {
      const reason = await waitPromise
      return { reason: reason.reason as WaitForAvailableJobsResult['reason'] }
    }

    return new Promise<WaitForAvailableJobsResult>((resolve, reject) => {
      const onAbort = () => resolve({ reason: 'aborted' })

      input.signal!.addEventListener('abort', onAbort, { once: true })

      waitPromise.then(
        (result) => {
          input.signal!.removeEventListener('abort', onAbort)
          resolve({ reason: result.reason as WaitForAvailableJobsResult['reason'] })
        },
        (error) => {
          input.signal!.removeEventListener('abort', onAbort)
          reject(error)
        }
      )
    })
  }
}
