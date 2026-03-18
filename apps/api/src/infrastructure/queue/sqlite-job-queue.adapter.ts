import { nanoid } from 'nanoid'
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
import type { SqliteConnection } from '../sqlite/connection.js'

interface QueueRow {
  id: string
  type: string
  dedupeKey: string | null
  payloadJson: string
  availableAt: number
  leaseOwner: string | null
  leaseUntil: number | null
  attempt: number
  maxAttempts: number
  priority: number
  createdAt: number
  updatedAt: number
  lastError: string | null
}

interface QueueStatsRow {
  totalQueued: number
  nextAvailableAt: number | null
  oldestQueuedAt: number | null
}

function toPayload<TPayload>(payloadJson: string): TPayload {
  return JSON.parse(payloadJson) as TPayload
}

function toEnvelope<TPayload>(row: QueueRow): QueueJobEnvelope<TPayload> {
  return {
    id: row.id,
    type: row.type,
    dedupeKey: row.dedupeKey,
    payload: toPayload<TPayload>(row.payloadJson),
    availableAt: row.availableAt,
    leaseOwner: row.leaseOwner,
    leaseUntil: row.leaseUntil,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    priority: row.priority,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastError: row.lastError,
  }
}

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

function nextUpdatedAt(previousUpdatedAt: number, now: number): number {
  return now > previousUpdatedAt ? now : previousUpdatedAt + 1
}

export class SqliteJobQueueAdapter implements JobQueuePort {
  private waitListeners = new Set<(signal: { type: string; availableAt: number }) => void>()
  private readonly lockRetryAttempts = 6
  private readonly lockRetryBaseMs = 20

  constructor(
    private connection: SqliteConnection,
    private transaction: TransactionPort
  ) {}

  private notifyWaiters(type: string, availableAt: number): void {
    for (const listener of this.waitListeners) {
      listener({ type, availableAt })
    }
  }

  private isSqliteLockError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    return /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(error.message)
  }

  private async wait(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms)
    })
  }

  private async withLockRetry<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0
    while (true) {
      try {
        return await operation()
      } catch (error) {
        attempt += 1
        if (!this.isSqliteLockError(error) || attempt >= this.lockRetryAttempts) {
          throw error
        }
        await this.wait(this.lockRetryBaseMs * 2 ** (attempt - 1))
      }
    }
  }

  private buildTypeFilter(types: string[] | undefined): { sql: string; params: unknown[] } {
    if (!types || types.length === 0) {
      return { sql: '', params: [] }
    }

    return {
      sql: ` AND type IN (${types.map(() => '?').join(', ')})`,
      params: types,
    }
  }

  private hasDueJobs(now: number, types: string[] | undefined): boolean {
    const typeFilter = this.buildTypeFilter(types)
    const row = this.connection.get<{ found: number }>(
      `SELECT 1 AS found
         FROM job_queue
        WHERE availableAt <= ?
          AND (leaseUntil IS NULL OR leaseUntil <= ?)
          ${typeFilter.sql}
        LIMIT 1`,
      [now, now, ...typeFilter.params]
    )

    return row?.found === 1
  }

  private getNextAvailableAt(now: number, types: string[] | undefined): number | null {
    const typeFilter = this.buildTypeFilter(types)
    const row = this.connection.get<{ nextAvailableAt: number | null }>(
      `SELECT MIN(availableAt) AS nextAvailableAt
         FROM job_queue
        WHERE (leaseUntil IS NULL OR leaseUntil <= ?)
          ${typeFilter.sql}`,
      [now, ...typeFilter.params]
    )

    return row?.nextAvailableAt ?? null
  }

  async enqueue<TPayload>(input: EnqueueJobInput<TPayload>): Promise<QueueJobEnvelope<TPayload>> {
    return this.withLockRetry(async () => {
      const now = Date.now()
      const id = nanoid()
      const availableAt = input.runAt ?? now
      const maxAttempts = normalizeAttempts(input.maxAttempts)
      const priority = normalizePriority(input.priority)

      this.connection.run(
        `INSERT INTO job_queue (
           id, type, dedupeKey, payloadJson, availableAt,
           leaseOwner, leaseUntil, attempt, maxAttempts, priority,
           createdAt, updatedAt, lastError
         ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, ?, ?, NULL)`,
        [
          id,
          input.type,
          input.dedupeKey ?? null,
          JSON.stringify(input.payload),
          availableAt,
          maxAttempts,
          priority,
          now,
          now,
        ]
      )

      const row = this.connection.get<QueueRow>('SELECT * FROM job_queue WHERE id = ?', [id])
      if (!row) {
        throw new Error(`Failed to load queued job ${id}.`)
      }
      this.notifyWaiters(input.type, availableAt)
      return toEnvelope<TPayload>(row)
    })
  }

  async upsertUnique<TPayload>(
    input: UpsertUniqueJobInput<TPayload>
  ): Promise<QueueJobEnvelope<TPayload>> {
    return this.withLockRetry(async () => {
      const now = Date.now()
      const maxAttempts = normalizeAttempts(input.maxAttempts)
      const priority = normalizePriority(input.priority)

      const row = await this.transaction.run(async () => {
        const existing = this.connection.get<QueueRow>(
          `SELECT *
             FROM job_queue
            WHERE type = ? AND dedupeKey = ?
            LIMIT 1`,
          [input.type, input.dedupeKey]
        )

        if (!existing) {
          const id = nanoid()
          this.connection.run(
            `INSERT INTO job_queue (
               id, type, dedupeKey, payloadJson, availableAt,
               leaseOwner, leaseUntil, attempt, maxAttempts, priority,
               createdAt, updatedAt, lastError
             ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, ?, ?, NULL)`,
            [
              id,
              input.type,
              input.dedupeKey,
              JSON.stringify(input.payload),
              input.runAt,
              maxAttempts,
              priority,
              now,
              now,
            ]
          )

          const inserted = this.connection.get<QueueRow>('SELECT * FROM job_queue WHERE id = ?', [
            id,
          ])
          if (!inserted) {
            throw new Error(`Failed to load queued job ${id}.`)
          }

          return inserted
        }

        const updatedAt = nextUpdatedAt(existing.updatedAt, now)

        this.connection.run(
          `UPDATE job_queue
              SET payloadJson = ?,
                  availableAt = ?,
                  leaseOwner = NULL,
                  leaseUntil = NULL,
                  attempt = 0,
                  maxAttempts = ?,
                  priority = ?,
                  updatedAt = ?,
                  lastError = NULL
            WHERE id = ?`,
          [
            JSON.stringify(input.payload),
            input.runAt,
            maxAttempts,
            priority,
            updatedAt,
            existing.id,
          ]
        )

        const updated = this.connection.get<QueueRow>('SELECT * FROM job_queue WHERE id = ?', [
          existing.id,
        ])
        if (!updated) {
          throw new Error(`Failed to upsert queued job ${input.type}:${input.dedupeKey}.`)
        }

        return updated
      })

      this.notifyWaiters(input.type, row.availableAt)
      return toEnvelope<TPayload>(row)
    })
  }

  async lease(input: LeaseJobsInput): Promise<Array<QueueJobEnvelope<unknown>>> {
    if (input.limit <= 0) return []

    return this.transaction.run(async () => {
      const typeFilterSql =
        input.types && input.types.length > 0
          ? 'AND type IN (' + input.types.map(() => '?').join(', ') + ')'
          : ''
      const typeFilterParams = input.types && input.types.length > 0 ? input.types : []

      const candidates = this.connection.all<{ id: string }>(
        `SELECT id
           FROM job_queue
          WHERE availableAt <= ?
            AND (leaseUntil IS NULL OR leaseUntil <= ?)
            ${typeFilterSql}
          ORDER BY priority DESC, availableAt ASC, createdAt ASC
          LIMIT ?`,
        [input.now, input.now, ...typeFilterParams, input.limit]
      )

      if (candidates.length === 0) return []

      const leased: Array<QueueJobEnvelope<unknown>> = []
      for (const candidate of candidates) {
        const result = this.connection.run(
          `UPDATE job_queue
              SET leaseOwner = ?,
                  leaseUntil = ?,
                  attempt = attempt + 1,
                  updatedAt = ?
            WHERE id = ?
              AND availableAt <= ?
              AND (leaseUntil IS NULL OR leaseUntil <= ?)`,
          [
            input.workerId,
            input.now + input.leaseDurationMs,
            input.now,
            candidate.id,
            input.now,
            input.now,
          ]
        )

        if (result.changes === 0) continue

        const row = this.connection.get<QueueRow>('SELECT * FROM job_queue WHERE id = ?', [
          candidate.id,
        ])
        if (row) {
          leased.push(toEnvelope(row))
        }
      }

      return leased
    })
  }

  async complete(input: CompleteLeasedJobInput): Promise<CompleteLeasedJobResult> {
    return this.transaction.run(async () => {
      const row = this.connection.get<QueueRow>('SELECT * FROM job_queue WHERE id = ?', [input.id])

      if (!row) {
        return 'missing'
      }

      if (row.leaseOwner !== input.workerId) {
        if (
          input.expectedUpdatedAt !== undefined &&
          Number.isFinite(input.expectedUpdatedAt) &&
          row.updatedAt !== input.expectedUpdatedAt
        ) {
          return 'released'
        }

        return 'missing'
      }

      if (
        input.expectedUpdatedAt !== undefined &&
        Number.isFinite(input.expectedUpdatedAt) &&
        row.updatedAt !== input.expectedUpdatedAt
      ) {
        this.connection.run(
          `UPDATE job_queue
              SET leaseOwner = NULL,
                  leaseUntil = NULL
            WHERE id = ? AND leaseOwner = ?`,
          [input.id, input.workerId]
        )
        this.notifyWaiters(row.type, row.availableAt)
        return 'released'
      }

      this.connection.run(`DELETE FROM job_queue WHERE id = ? AND leaseOwner = ?`, [
        input.id,
        input.workerId,
      ])
      return 'completed'
    })
  }

  async fail(input: FailLeasedJobInput): Promise<'retrying' | 'dead' | 'missing'> {
    return this.transaction.run(async () => {
      const row = this.connection.get<QueueRow>(
        `SELECT * FROM job_queue WHERE id = ? AND leaseOwner = ?`,
        [input.id, input.workerId]
      )

      if (!row) {
        return 'missing'
      }

      if (row.attempt >= row.maxAttempts) {
        this.connection.run(
          `INSERT INTO job_queue_dead_letters (
             id, type, dedupeKey, payloadJson, attempt, maxAttempts,
             lastError, failedAt, createdAt
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.id,
            row.type,
            row.dedupeKey,
            row.payloadJson,
            row.attempt,
            row.maxAttempts,
            input.error,
            input.now,
            row.createdAt,
          ]
        )

        this.connection.run('DELETE FROM job_queue WHERE id = ?', [row.id])
        return 'dead'
      }

      this.connection.run(
        `UPDATE job_queue
            SET leaseOwner = NULL,
                leaseUntil = NULL,
                availableAt = ?,
                updatedAt = ?,
                lastError = ?
          WHERE id = ?`,
        [input.now + input.retryDelayMs, input.now, input.error, row.id]
      )

      this.notifyWaiters(row.type, input.now + input.retryDelayMs)

      return 'retrying'
    })
  }

  async getByTypeAndDedupeKey<TPayload>(
    type: string,
    dedupeKey: string
  ): Promise<QueueJobEnvelope<TPayload> | undefined> {
    const row = this.connection.get<QueueRow>(
      `SELECT *
         FROM job_queue
        WHERE type = ? AND dedupeKey = ?
        LIMIT 1`,
      [type, dedupeKey]
    )

    return row ? toEnvelope<TPayload>(row) : undefined
  }

  async getByTypeAndDedupeKeys<TPayload>(
    type: string,
    dedupeKeys: string[]
  ): Promise<Array<QueueJobEnvelope<TPayload>>> {
    if (dedupeKeys.length === 0) return []

    const placeholders = dedupeKeys.map(() => '?').join(', ')
    const rows = this.connection.all<QueueRow>(
      `SELECT *
         FROM job_queue
        WHERE type = ?
          AND dedupeKey IN (${placeholders})`,
      [type, ...dedupeKeys]
    )

    return rows.map((row) => toEnvelope<TPayload>(row))
  }

  async listQueuedByType<TPayload>(type: string): Promise<Array<QueueJobEnvelope<TPayload>>> {
    const rows = this.connection.all<QueueRow>(
      `SELECT *
         FROM job_queue
        WHERE type = ?
        ORDER BY createdAt ASC`,
      [type]
    )

    return rows.map((row) => toEnvelope<TPayload>(row))
  }

  async deleteQueuedByTypeAndDedupeKeys(type: string, dedupeKeys: string[]): Promise<void> {
    if (dedupeKeys.length === 0) return
    await this.withLockRetry(async () => {
      const placeholders = dedupeKeys.map(() => '?').join(', ')
      this.connection.run(
        `DELETE FROM job_queue
          WHERE type = ?
            AND dedupeKey IN (${placeholders})`,
        [type, ...dedupeKeys]
      )
    })
  }

  async getTypeStats(type: string): Promise<JobQueueTypeStats> {
    const row = this.connection.get<QueueStatsRow>(
      `SELECT
         COUNT(*) AS totalQueued,
         MIN(availableAt) AS nextAvailableAt,
         MIN(createdAt) AS oldestQueuedAt
       FROM job_queue
       WHERE type = ?`,
      [type]
    )

    return {
      totalQueued: row?.totalQueued ?? 0,
      nextAvailableAt: row?.nextAvailableAt ?? null,
      oldestQueuedAt: row?.oldestQueuedAt ?? null,
    }
  }

  async waitForAvailable(input: WaitForAvailableJobsInput): Promise<WaitForAvailableJobsResult> {
    if (input.signal?.aborted) {
      return { reason: 'aborted' }
    }

    if (input.timeoutMs <= 0) {
      return { reason: 'timeout' }
    }

    if (this.hasDueJobs(input.now, input.types)) {
      return { reason: 'due' }
    }

    const maxWakeAt = input.now + input.timeoutMs
    const nextAvailableAt = this.getNextAvailableAt(input.now, input.types)
    const wakeAt =
      nextAvailableAt !== null
        ? Math.min(maxWakeAt, Math.max(nextAvailableAt, input.now))
        : maxWakeAt

    const wakeDelayMs = Math.max(1, wakeAt - input.now)

    return new Promise<WaitForAvailableJobsResult>((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null

      const settle = (result: WaitForAvailableJobsResult) => {
        if (settled) return
        settled = true
        this.waitListeners.delete(onSignal)
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        if (input.signal) {
          input.signal.removeEventListener('abort', onAbort)
        }
        resolve(result)
      }

      const onSignal = (signal: { type: string; availableAt: number }) => {
        if (input.types && input.types.length > 0 && !input.types.includes(signal.type)) {
          return
        }

        settle({ reason: signal.availableAt <= Date.now() ? 'notified' : 'scheduled' })
      }

      const onAbort = () => {
        settle({ reason: 'aborted' })
      }

      this.waitListeners.add(onSignal)

      if (input.signal) {
        input.signal.addEventListener('abort', onAbort, { once: true })
      }

      // Close the check->listen race by re-checking after subscribing.
      if (this.hasDueJobs(Date.now(), input.types)) {
        settle({ reason: 'due' })
        return
      }

      timer = setTimeout(() => {
        settle({ reason: wakeAt < maxWakeAt ? 'scheduled' : 'timeout' })
      }, wakeDelayMs)

      if (typeof timer.unref === 'function') {
        timer.unref()
      }
    })
  }
}
