import type { ServiceSet } from '../core/services/types.js'
import type { RepositorySet } from '../core/ports/types.js'
import type { TransactionPort } from '../core/ports/transaction.port.js'
import { createSqliteAdapter } from '../infrastructure/sqlite/factory.js'
import { createYjsRuntime, type YjsRuntime, type YjsRuntimeConfig } from '../yjs/runtime.js'
import { createChatRuntime, type ChatRuntime } from '../chat/runtime.js'
import { createInlineRuntime, type InlineRuntime } from '../inline/runtime.js'
import { configureAiProvider } from '../ai/index.js'
import { configureEmbeddingProvider } from '../embeddings/provider.js'
import {
  createDocumentImportJobHandler,
  createDocumentImportRuntime,
  type DocumentImportRuntime,
} from './document-import-runtime.js'
import type { AuthPort } from '../core/ports/auth.port.js'
import { LocalAuthAdapter } from '../infrastructure/auth/local-auth.adapter.js'
import { SqliteAuthAdapter } from '../infrastructure/auth/sqlite-auth.adapter.js'
import { configManager } from '../config/runtime.js'
import { createJobWorkerRuntime, type JobWorkerRuntime } from './job-worker-runtime.js'
import { DOCUMENT_IMPORT_JOB_TYPE } from '../core/jobs/job-types.js'
import {
  createEmbeddingReindexBatchHandler,
  EMBEDDING_REINDEX_JOB_TYPE,
} from './embedding-reindex-runtime.js'

export interface AppContainer {
  services: ServiceSet
  repositories: RepositorySet
  transaction: TransactionPort
  authPort: AuthPort
  yjsRuntime: YjsRuntime
  chatRuntime: ChatRuntime
  inlineRuntime: InlineRuntime
  documentImportRuntime: DocumentImportRuntime
  jobWorkerRuntime: JobWorkerRuntime
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
  const documentImportRuntime = createDocumentImportRuntime({
    queue: adapter.jobQueue,
  })
  const documentImportJobHandler = createDocumentImportJobHandler({
    dbPath,
    services: adapter.services,
    repositories: adapter.repositories,
    transaction: adapter.transaction,
    hooks: {
      // SQLite/Bun-specific bridge: native import writes through a different
      // SQLite stack than Bun's in-process handle, so we refresh Bun's handle
      // after native commits. Postgres adapters should use a no-op hook.
      afterExternalWriteCommit: () => adapter.connection.refreshPrimaryConnection(),
    },
  })
  const jobWorkerRuntime = createJobWorkerRuntime({
    queue: adapter.jobQueue,
    handlers: {
      [DOCUMENT_IMPORT_JOB_TYPE]: documentImportJobHandler,
      [EMBEDDING_REINDEX_JOB_TYPE]: createEmbeddingReindexBatchHandler(
        adapter.services.embeddingIndex
      ),
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
    chatRuntime,
    inlineRuntime,
    documentImportRuntime,
    jobWorkerRuntime,
  }
}
