export interface QueueJobEnvelope<TPayload = unknown> {
  id: string
  type: string
  dedupeKey: string | null
  payload: TPayload
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

export interface EnqueueJobInput<TPayload = unknown> {
  type: string
  payload: TPayload
  runAt?: number
  dedupeKey?: string
  maxAttempts?: number
  priority?: number
}

export interface UpsertUniqueJobInput<TPayload = unknown> {
  type: string
  dedupeKey: string
  payload: TPayload
  runAt: number
  maxAttempts?: number
  priority?: number
}

export interface LeaseJobsInput {
  workerId: string
  now: number
  leaseDurationMs: number
  limit: number
  types?: string[]
}

export interface FailLeasedJobInput {
  id: string
  workerId: string
  now: number
  error: string
  retryDelayMs: number
}

export interface CompleteLeasedJobInput {
  id: string
  workerId: string
  expectedUpdatedAt?: number
}

export type CompleteLeasedJobResult = 'completed' | 'released' | 'missing'

export interface JobQueueTypeStats {
  totalQueued: number
  nextAvailableAt: number | null
  oldestQueuedAt: number | null
}

export interface WaitForAvailableJobsInput {
  now: number
  timeoutMs: number
  types?: string[]
  signal?: AbortSignal
}

export interface WaitForAvailableJobsResult {
  reason: 'due' | 'notified' | 'scheduled' | 'timeout' | 'aborted'
}

export interface JobQueuePort {
  enqueue<TPayload>(input: EnqueueJobInput<TPayload>): Promise<QueueJobEnvelope<TPayload>>
  upsertUnique<TPayload>(input: UpsertUniqueJobInput<TPayload>): Promise<QueueJobEnvelope<TPayload>>
  lease(input: LeaseJobsInput): Promise<Array<QueueJobEnvelope<unknown>>>
  complete(input: CompleteLeasedJobInput): Promise<CompleteLeasedJobResult>
  fail(input: FailLeasedJobInput): Promise<'retrying' | 'dead' | 'missing'>
  getByTypeAndDedupeKey<TPayload>(
    type: string,
    dedupeKey: string
  ): Promise<QueueJobEnvelope<TPayload> | undefined>
  getByTypeAndDedupeKeys<TPayload>(
    type: string,
    dedupeKeys: string[]
  ): Promise<Array<QueueJobEnvelope<TPayload>>>
  listQueuedByType<TPayload>(type: string): Promise<Array<QueueJobEnvelope<TPayload>>>
  deleteQueuedByTypeAndDedupeKeys(type: string, dedupeKeys: string[]): Promise<void>
  getTypeStats(type: string): Promise<JobQueueTypeStats>
  waitForAvailable(input: WaitForAvailableJobsInput): Promise<WaitForAvailableJobsResult>
}
