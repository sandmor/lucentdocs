import { describe, expect, test } from 'bun:test'
import { createJobWorkerRuntime } from './job-worker-runtime.js'
import type {
  CompleteLeasedJobInput,
  CompleteLeasedJobResult,
  EnqueueJobInput,
  FailLeasedJobInput,
  JobQueuePort,
  JobQueueTypeStats,
  LeaseJobsInput,
  QueueJobEnvelope,
  UpsertUniqueJobInput,
  WaitForAvailableJobsInput,
  WaitForAvailableJobsResult,
} from '../core/ports/jobQueue.port.js'

class RecordingQueue implements JobQueuePort {
  leaseInput: LeaseJobsInput | null = null
  leasedJobs: Array<QueueJobEnvelope<unknown>> = []
  completedJobIds: string[] = []
  failedJobIds: string[] = []

  async enqueue<TPayload>(_input: EnqueueJobInput<TPayload>): Promise<QueueJobEnvelope<TPayload>> {
    throw new Error('not used')
  }

  async upsertUnique<TPayload>(
    _input: UpsertUniqueJobInput<TPayload>
  ): Promise<QueueJobEnvelope<TPayload>> {
    throw new Error('not used')
  }

  async lease(input: LeaseJobsInput): Promise<Array<QueueJobEnvelope<unknown>>> {
    this.leaseInput = input
    return this.leasedJobs
  }

  async complete(input: CompleteLeasedJobInput): Promise<CompleteLeasedJobResult> {
    this.completedJobIds.push(input.id)
    return 'missing'
  }

  async fail(input: FailLeasedJobInput): Promise<'retrying' | 'dead' | 'missing'> {
    this.failedJobIds.push(input.id)
    return 'missing'
  }

  async getByTypeAndDedupeKey<TPayload>(
    _type: string,
    _dedupeKey: string
  ): Promise<QueueJobEnvelope<TPayload> | undefined> {
    return undefined
  }

  async getByTypeAndDedupeKeys<TPayload>(
    _type: string,
    _dedupeKeys: string[]
  ): Promise<Array<QueueJobEnvelope<TPayload>>> {
    return []
  }

  async listQueuedByType<TPayload>(_type: string): Promise<Array<QueueJobEnvelope<TPayload>>> {
    return []
  }

  async deleteQueuedByTypeAndDedupeKeys(_type: string, _dedupeKeys: string[]): Promise<void> {
    return
  }

  async getTypeStats(_type: string): Promise<JobQueueTypeStats> {
    return { totalQueued: 0, nextAvailableAt: null, oldestQueuedAt: null }
  }

  async waitForAvailable(_input: WaitForAvailableJobsInput): Promise<WaitForAvailableJobsResult> {
    return { reason: 'timeout' }
  }
}

describe('JobWorkerRuntime', () => {
  test('leases only handled job types', async () => {
    const queue = new RecordingQueue()
    const runtime = createJobWorkerRuntime({
      queue,
      handlers: {
        'documents.import': async () => {},
        'embedding.reindex-document': async () => {},
      },
    })

    runtime.start()
    try {
      await runtime.tickOnce()
      expect(queue.leaseInput?.types).toEqual(['documents.import', 'embedding.reindex-document'])
    } finally {
      await runtime.stop()
    }
  })

  test('runs batch handlers once per job type and completes each leased envelope', async () => {
    const queue = new RecordingQueue()
    const handled: string[][] = []
    queue.leasedJobs = [
      {
        id: 'job-1',
        type: 'embedding.reindex-document',
        dedupeKey: 'doc-a',
        payload: { documentId: 'doc-a' },
        availableAt: 0,
        leaseOwner: 'worker',
        leaseUntil: 1,
        attempt: 1,
        maxAttempts: 8,
        priority: 0,
        createdAt: 0,
        updatedAt: 0,
        lastError: null,
      },
      {
        id: 'job-2',
        type: 'embedding.reindex-document',
        dedupeKey: 'doc-b',
        payload: { documentId: 'doc-b' },
        availableAt: 0,
        leaseOwner: 'worker',
        leaseUntil: 1,
        attempt: 1,
        maxAttempts: 8,
        priority: 0,
        createdAt: 0,
        updatedAt: 0,
        lastError: null,
      },
    ]

    const runtime = createJobWorkerRuntime({
      queue,
      handlers: {
        'embedding.reindex-document': {
          mode: 'batch',
          handle: async (jobs) => {
            handled.push(
              jobs.map((job) => String((job.payload as { documentId: string }).documentId))
            )
          },
        },
      },
    })

    runtime.start()
    try {
      await runtime.tickOnce()
      expect(handled).toEqual([['doc-a', 'doc-b']])
      expect(queue.completedJobIds.sort()).toEqual(['job-1', 'job-2'])
      expect(queue.failedJobIds).toEqual([])
    } finally {
      await runtime.stop()
    }
  })
})
