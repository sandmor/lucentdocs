import { createSqliteAdapter } from '../infrastructure/sqlite/factory.js'
import type { ServiceSet } from '../core/services/types.js'
import type { RepositorySet } from '../core/ports/types.js'
import type { TransactionPort } from '../core/ports/transaction.port.js'

export interface TestAdapter {
  services: ServiceSet
  repositories: RepositorySet
  transaction: TransactionPort
}

export function createTestAdapter(): TestAdapter {
  const adapter = createSqliteAdapter(':memory:')
  return {
    services: adapter.services,
    repositories: adapter.repositories,
    transaction: adapter.transaction,
  }
}
