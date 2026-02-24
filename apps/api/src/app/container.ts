import type { ServiceSet } from '../core/services/types.js'
import type { RepositorySet } from '../core/ports/types.js'
import type { TransactionPort } from '../core/ports/transaction.port.js'
import { createSqliteAdapter } from '../infrastructure/sqlite/factory.js'
import { createYjsRuntime, type YjsRuntime, type YjsRuntimeConfig } from '../yjs/runtime.js'
import { createChatRuntime, type ChatRuntime } from '../chat/runtime.js'

export interface AppContainer {
  services: ServiceSet
  repositories: RepositorySet
  transaction: TransactionPort
  yjsRuntime: YjsRuntime
  chatRuntime: ChatRuntime
}

export function createContainer(dbPath: string, yjsConfig: YjsRuntimeConfig): AppContainer {
  const adapter = createSqliteAdapter(dbPath)

  const yjsRuntime = createYjsRuntime(
    {
      yjsDocuments: adapter.repositories.yjsDocuments,
      versionSnapshots: adapter.repositories.versionSnapshots,
    },
    yjsConfig
  )

  const chatRuntime = createChatRuntime(adapter.services)

  return {
    services: adapter.services,
    repositories: adapter.repositories,
    transaction: adapter.transaction,
    yjsRuntime,
    chatRuntime,
  }
}
