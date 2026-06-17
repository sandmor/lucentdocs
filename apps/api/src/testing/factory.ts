import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { RepositorySet } from '../core/ports/types.js'
import type { ServiceSet } from '../core/services/types.js'
import type { TransactionPort } from '../core/ports/transaction.port.js'
import type { JobQueuePort } from '../core/ports/jobQueue.port.js'
import {
  createRustAdapterFromEngine,
  type CreateRustAdapterOptions,
  type RustAdapter,
} from '../infrastructure/rust/factory.js'
import { openRustStorage, openRustStorageSync } from '../infrastructure/rust/engine.js'

export interface CreateTestAdapterOptions extends CreateRustAdapterOptions {
  dbPath?: string
}

export interface TestAdapter {
  dbPath: string
  adapter: RustAdapter
  services: ServiceSet
  repositories: RepositorySet
  transaction: TransactionPort
  jobQueue: JobQueuePort
}

export function createTestAdapter(options: CreateTestAdapterOptions = {}): TestAdapter {
  const dbPath = options.dbPath ?? ':memory:'
  ensureMemoryDbTempDir()
  const engine = openRustStorageSync(dbPath)
  const adapter = createRustAdapterFromEngine(engine, options)
  return {
    dbPath,
    adapter,
    services: adapter.services,
    repositories: adapter.repositories,
    transaction: adapter.transaction,
    jobQueue: adapter.jobQueue,
  }
}

export async function createTestAdapterAsync(
  options: CreateTestAdapterOptions = {}
): Promise<TestAdapter> {
  const dbPath = options.dbPath ?? ':memory:'
  ensureMemoryDbTempDir()
  const engine = await openRustStorage(dbPath)
  const adapter = createRustAdapterFromEngine(engine, options)
  return {
    dbPath,
    adapter,
    services: adapter.services,
    repositories: adapter.repositories,
    transaction: adapter.transaction,
    jobQueue: adapter.jobQueue,
  }
}

function ensureMemoryDbTempDir(): void {
  const tmpDir = process.env.LUCENTDOCS_MEM_DB_DIR ?? join(process.cwd(), 'tmp')
  mkdirSync(tmpDir, { recursive: true })
  process.env.LUCENTDOCS_MEM_DB_DIR ??= tmpDir
  process.env.TMPDIR ??= tmpDir
}
