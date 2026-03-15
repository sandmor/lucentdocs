import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSqliteAdapter } from '../sqlite/factory.js'
import { DOCUMENT_IMPORT_JOB_TYPE } from '../../core/jobs/job-types.js'

function uniqueDbPath(label: string): string {
  const dir = resolve(`data-test/${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return resolve(dir, 'app.db')
}

describe('SqliteJobQueueAdapter', () => {
  let cleanupDir: string | null = null

  afterEach(() => {
    if (cleanupDir) {
      rmSync(cleanupDir, { recursive: true, force: true })
      cleanupDir = null
    }
  })

  test('waitForAvailable does not miss immediate enqueues', async () => {
    const dbPath = uniqueDbPath('sqlite-job-queue-wakeup-race')
    cleanupDir = resolve(dbPath, '..')
    const adapter = createSqliteAdapter(dbPath)

    try {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const waitPromise = adapter.jobQueue.waitForAvailable({
          now: Date.now(),
          timeoutMs: 300,
          types: [DOCUMENT_IMPORT_JOB_TYPE],
        })

        await adapter.jobQueue.enqueue({
          type: DOCUMENT_IMPORT_JOB_TYPE,
          payload: { attempt },
        })

        const wake = await waitPromise
        expect(wake.reason).not.toBe('timeout')

        const leased = await adapter.jobQueue.lease({
          workerId: 'test-worker',
          now: Date.now(),
          leaseDurationMs: 10_000,
          limit: 1,
          types: [DOCUMENT_IMPORT_JOB_TYPE],
        })

        expect(leased.length).toBe(1)
        await adapter.jobQueue.complete({ id: leased[0]!.id, workerId: 'test-worker' })
      }
    } finally {
      adapter.connection.close()
    }
  })

  test('complete releases leased job when payload was updated mid-flight', async () => {
    const dbPath = uniqueDbPath('sqlite-job-queue-complete-release')
    cleanupDir = resolve(dbPath, '..')
    const adapter = createSqliteAdapter(dbPath)

    try {
      const job = await adapter.jobQueue.upsertUnique({
        type: DOCUMENT_IMPORT_JOB_TYPE,
        dedupeKey: 'doc-1',
        payload: { version: 1 },
        runAt: Date.now(),
      })

      const leased = await adapter.jobQueue.lease({
        workerId: 'worker-a',
        now: Date.now(),
        leaseDurationMs: 10_000,
        limit: 1,
        types: [DOCUMENT_IMPORT_JOB_TYPE],
      })

      expect(leased).toHaveLength(1)

      await adapter.jobQueue.upsertUnique({
        type: DOCUMENT_IMPORT_JOB_TYPE,
        dedupeKey: 'doc-1',
        payload: { version: 2 },
        runAt: Date.now(),
      })

      const completion = await adapter.jobQueue.complete({
        id: job.id,
        workerId: 'worker-a',
        expectedUpdatedAt: leased[0]!.updatedAt,
      })
      expect(completion).toBe('released')

      const after = await adapter.jobQueue.getByTypeAndDedupeKey<{ version: number }>(
        DOCUMENT_IMPORT_JOB_TYPE,
        'doc-1'
      )
      expect(after?.payload.version).toBe(2)
      expect(after?.leaseOwner).toBeNull()
    } finally {
      adapter.connection.close()
    }
  })
})
