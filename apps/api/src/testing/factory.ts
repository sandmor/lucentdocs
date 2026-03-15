import { createSqliteAdapter } from '../infrastructure/sqlite/factory.js'
import type { ServiceSet } from '../core/services/types.js'
import type { RepositorySet } from '../core/ports/types.js'
import type { TransactionPort } from '../core/ports/transaction.port.js'
import type { JobQueuePort } from '../core/ports/jobQueue.port.js'

export interface TestAdapter {
  dbPath: string
  services: ServiceSet
  repositories: RepositorySet
  transaction: TransactionPort
  jobQueue: JobQueuePort
  afterExternalWriteCommit: () => void
}

export function createTestAdapter(options: { dbPath?: string } = {}): TestAdapter {
  const dbPath = options.dbPath ?? ':memory:'
  const adapter = createSqliteAdapter(dbPath)
  return {
    dbPath,
    services: adapter.services,
    repositories: adapter.repositories,
    transaction: adapter.transaction,
    jobQueue: adapter.jobQueue,
    afterExternalWriteCommit: () => adapter.connection.refreshPrimaryConnection(),
  }
}
