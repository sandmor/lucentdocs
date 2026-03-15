import type { ServiceSet } from '../core/services/types.js'
import type { RepositorySet } from '../core/ports/types.js'
import type { TransactionPort } from '../core/ports/transaction.port.js'
import { createSqliteAdapter } from '../infrastructure/sqlite/factory.js'
import { createYjsRuntime, type YjsRuntime, type YjsRuntimeConfig } from '../yjs/runtime.js'
import { createChatRuntime, type ChatRuntime } from '../chat/runtime.js'
import { createInlineRuntime, type InlineRuntime } from '../inline/runtime.js'
import { configureAiProvider } from '../ai/index.js'
import { configureEmbeddingProvider } from '../embeddings/provider.js'
import { createEmbeddingRuntime, type EmbeddingRuntime } from '../embeddings/runtime.js'
import {
  createDocumentImportRuntime,
  type DocumentImportJob,
  type DocumentImportRuntime,
} from './document-import-runtime.js'
import { InMemoryJobQueue } from '../infrastructure/queue/in-memory-job-queue.adapter.js'
import type { AuthPort } from '../core/ports/auth.port.js'
import { LocalAuthAdapter } from '../infrastructure/auth/local-auth.adapter.js'
import { SqliteAuthAdapter } from '../infrastructure/auth/sqlite-auth.adapter.js'
import { configManager } from '../config/runtime.js'

export interface AppContainer {
  services: ServiceSet
  repositories: RepositorySet
  transaction: TransactionPort
  authPort: AuthPort
  yjsRuntime: YjsRuntime
  embeddingRuntime: EmbeddingRuntime
  chatRuntime: ChatRuntime
  inlineRuntime: InlineRuntime
  documentImportRuntime: DocumentImportRuntime
}

/**
 * Builds the long-lived application graph in dependency order.
 *
 * AI and embedding providers are configured from persisted settings before any
 * runtime is created so later calls resolve against the same store-backed config.
 */
export async function createContainer(
  dbPath: string,
  yjsConfig: YjsRuntimeConfig
): Promise<AppContainer> {
  const adapter = createSqliteAdapter(dbPath)
  await adapter.services.aiSettings.initializeDefaults({ env: process.env })
  configureAiProvider(adapter.services.aiSettings)
  configureEmbeddingProvider(adapter.services.aiSettings)

  const appConfig = configManager.getConfig()
  let authPort: AuthPort

  if (appConfig.auth.enabled) {
    await adapter.services.auth.ensureDefaultAdminUser({ env: process.env })
    authPort = new SqliteAuthAdapter(adapter.services.auth)
  } else {
    authPort = new LocalAuthAdapter()
  }

  const embeddingRuntime = createEmbeddingRuntime(adapter.services.embeddingIndex, {
    debounceMs: appConfig.embeddings.debounceMs,
    batchMaxWaitMs: appConfig.embeddings.batchMaxWaitMs,
  })

  const yjsRuntime = createYjsRuntime(
    {
      yjsDocuments: adapter.repositories.yjsDocuments,
      versionSnapshots: adapter.repositories.versionSnapshots,
    },
    yjsConfig,
    {
      onDocumentPersisted: (documentId) =>
        adapter.services.embeddingIndex.enqueueDocument(documentId),
    }
  )

  const chatRuntime = createChatRuntime(adapter.services)
  const documentImportQueue = new InMemoryJobQueue<DocumentImportJob>()
  const documentImportRuntime = createDocumentImportRuntime({
    dbPath,
    services: adapter.services,
    repositories: adapter.repositories,
    transaction: adapter.transaction,
    queue: documentImportQueue,
    hooks: {
      // SQLite/Bun-specific bridge: native import writes through a different
      // SQLite stack than Bun's in-process handle, so we refresh Bun's handle
      // after native commits. Postgres adapters should use a no-op hook.
      afterExternalWriteCommit: () => adapter.connection.refreshPrimaryConnection(),
    },
  })
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
    authPort,
    yjsRuntime,
    embeddingRuntime,
    chatRuntime,
    inlineRuntime,
    documentImportRuntime,
  }
}
