import type { ServiceSet } from '../core/services/types.js'
import type { RepositorySet } from '../core/ports/types.js'
import type { TransactionPort } from '../core/ports/transaction.port.js'
import { createSqliteAdapter } from '../infrastructure/sqlite/factory.js'
import { createYjsRuntime, type YjsRuntime, type YjsRuntimeConfig } from '../yjs/runtime.js'
import { createChatRuntime, type ChatRuntime } from '../chat/runtime.js'
import { createInlineRuntime, type InlineRuntime } from '../inline/runtime.js'
import { configureAiProvider } from '../ai/index.js'

export interface AppContainer {
  services: ServiceSet
  repositories: RepositorySet
  transaction: TransactionPort
  yjsRuntime: YjsRuntime
  chatRuntime: ChatRuntime
  inlineRuntime: InlineRuntime
}

export async function createContainer(
  dbPath: string,
  yjsConfig: YjsRuntimeConfig
): Promise<AppContainer> {
  const adapter = createSqliteAdapter(dbPath)
  await adapter.services.aiSettings.initializeDefaults({ env: process.env })
  configureAiProvider(adapter.services.aiSettings)

  const yjsRuntime = createYjsRuntime(
    {
      yjsDocuments: adapter.repositories.yjsDocuments,
      versionSnapshots: adapter.repositories.versionSnapshots,
    },
    yjsConfig
  )

  const chatRuntime = createChatRuntime(adapter.services)
  const inlineRuntime = createInlineRuntime(
    adapter.services,
    {
      documents: adapter.repositories.documents,
      projectDocuments: adapter.repositories.projectDocuments,
      yjsDocuments: adapter.repositories.yjsDocuments,
    },
    yjsRuntime
  )

  return {
    services: adapter.services,
    repositories: adapter.repositories,
    transaction: adapter.transaction,
    yjsRuntime,
    chatRuntime,
    inlineRuntime,
  }
}
