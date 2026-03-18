import type { RepositorySet } from '../../core/ports/types.js'
import type { ServiceSet } from '../../core/services/types.js'
import type { TransactionPort } from '../../core/ports/transaction.port.js'
import { createConnection, SqliteConnection } from './connection.js'
import { createTransaction } from './transaction.js'
import { ProjectsRepository } from './projects.adapter.js'
import { DocumentsRepository } from './documents.adapter.js'
import { ProjectDocumentsRepository } from './projectDocuments.adapter.js'
import { ChatsRepository } from './chats.adapter.js'
import { VersionSnapshotsRepository } from './versionSnapshots.adapter.js'
import { YjsDocumentsRepository } from './yjsDocuments.adapter.js'
import { AiSettingsRepository } from './aiSettings.adapter.js'
import { IndexingSettingsRepository } from './indexingSettings.adapter.js'
import { DocumentEmbeddingsRepository } from './documentEmbeddings.adapter.js'
import { EmbeddingIndexQueueRepository } from './embeddingIndexQueue.adapter.js'
import { AuthDataRepository } from './authData.adapter.js'
import { createProjectsService } from '../../core/services/projects.service.js'
import { createDocumentsService } from '../../core/services/documents.service.js'
import { createChatsService } from '../../core/services/chats.service.js'
import { createAiSettingsService } from '../../core/services/aiSettings.service.js'
import { createIndexingSettingsService } from '../../core/services/indexingSettings.service.js'
import { createEmbeddingIndexService } from '../../core/services/embeddingIndex.service.js'
import { createAuthService } from '../../core/services/auth.service.js'
import { configManager } from '../../config/runtime.js'
import { SqliteJobQueueAdapter } from '../queue/sqlite-job-queue.adapter.js'
import type { JobQueuePort } from '../../core/ports/jobQueue.port.js'
import type { DocumentEmbeddingsRepositoryPort } from '../../core/ports/documentEmbeddings.port.js'
import type { DocumentEmbeddingMetadataStorePort } from '../../core/ports/documentEmbeddingMetadata.port.js'
import { SqliteDocumentEmbeddingMetadataStore } from './documentEmbeddingMetadataStore.adapter.js'

export interface SqliteAdapter {
  connection: SqliteConnection
  transaction: TransactionPort
  jobQueue: JobQueuePort
  metadataStores: {
    documentEmbeddings: DocumentEmbeddingMetadataStorePort
  }
  repositories: RepositorySet
  services: ServiceSet
}

export function createSqliteAdapter(
  dbPath: string,
  options: {
    createDocumentEmbeddings?: (dependencies: {
      connection: SqliteConnection
      metadataStore: DocumentEmbeddingMetadataStorePort
    }) => DocumentEmbeddingsRepositoryPort
  } = {}
): SqliteAdapter {
  const connection = createConnection(dbPath)
  const transaction = createTransaction(connection)
  const jobQueue = new SqliteJobQueueAdapter(connection, transaction)
  const metadataStore = new SqliteDocumentEmbeddingMetadataStore(connection)
  const documentEmbeddings =
    options.createDocumentEmbeddings?.({ connection, metadataStore }) ??
    new DocumentEmbeddingsRepository(connection)

  const repositories: RepositorySet = {
    projects: new ProjectsRepository(connection),
    documents: new DocumentsRepository(connection),
    projectDocuments: new ProjectDocumentsRepository(connection),
    chats: new ChatsRepository(connection),
    versionSnapshots: new VersionSnapshotsRepository(connection),
    yjsDocuments: new YjsDocumentsRepository(connection),
    aiSettings: new AiSettingsRepository(connection),
    indexingSettings: new IndexingSettingsRepository(connection),
    embeddingIndexQueue: new EmbeddingIndexQueueRepository(jobQueue),
    documentEmbeddings,
    authData: new AuthDataRepository(connection),
  }

  const aiSettings = createAiSettingsService(repositories, transaction)
  const indexingSettings = createIndexingSettingsService(repositories)
  const embeddingIndex = createEmbeddingIndexService(
    repositories,
    transaction,
    jobQueue,
    aiSettings,
    indexingSettings,
    {
      getRuntimeConfig: () => configManager.getConfig().embeddings,
    }
  )

  const services: ServiceSet = {
    projects: createProjectsService(repositories, transaction, {
      onDocumentsDeleted: (documentIds, references) =>
        embeddingIndex.deleteDocuments(documentIds, { references }),
    }),
    documents: createDocumentsService(repositories, transaction, aiSettings, {
      onDocumentContentStored: (documentId) => embeddingIndex.enqueueDocument(documentId),
      onDocumentsContentStored: (documentIds) => embeddingIndex.enqueueDocuments(documentIds),
      onDocumentsDeleted: (documentIds, references) =>
        embeddingIndex.deleteDocuments(documentIds, { references }),
    }),
    chats: createChatsService(repositories),
    aiSettings,
    indexingSettings,
    embeddingIndex,
    auth: createAuthService(repositories, transaction),
  }

  return {
    connection,
    transaction,
    jobQueue,
    metadataStores: {
      documentEmbeddings: metadataStore,
    },
    repositories,
    services,
  }
}
