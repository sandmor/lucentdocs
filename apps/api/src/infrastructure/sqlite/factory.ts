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
import { AuthDataRepository } from './authData.adapter.js'
import { createProjectsService } from '../../core/services/projects.service.js'
import { createDocumentsService } from '../../core/services/documents.service.js'
import { createChatsService } from '../../core/services/chats.service.js'
import { createAiSettingsService } from '../../core/services/aiSettings.service.js'
import { createIndexingSettingsService } from '../../core/services/indexingSettings.service.js'
import { createEmbeddingIndexService } from '../../core/services/embeddingIndex.service.js'
import { createAuthService } from '../../core/services/auth.service.js'
import { configManager } from '../../config/runtime.js'

export interface SqliteAdapter {
  connection: SqliteConnection
  transaction: TransactionPort
  repositories: RepositorySet
  services: ServiceSet
}

export function createSqliteAdapter(dbPath: string): SqliteAdapter {
  const connection = createConnection(dbPath)
  const transaction = createTransaction(connection)

  const repositories: RepositorySet = {
    projects: new ProjectsRepository(connection),
    documents: new DocumentsRepository(connection),
    projectDocuments: new ProjectDocumentsRepository(connection),
    chats: new ChatsRepository(connection),
    versionSnapshots: new VersionSnapshotsRepository(connection),
    yjsDocuments: new YjsDocumentsRepository(connection),
    aiSettings: new AiSettingsRepository(connection),
    indexingSettings: new IndexingSettingsRepository(connection),
    documentEmbeddings: new DocumentEmbeddingsRepository(connection),
    authData: new AuthDataRepository(connection),
  }

  const aiSettings = createAiSettingsService(repositories, transaction)
  const indexingSettings = createIndexingSettingsService(repositories)
  const embeddingIndex = createEmbeddingIndexService(
    repositories,
    transaction,
    aiSettings,
    indexingSettings,
    {
      getRuntimeConfig: () => configManager.getConfig().embeddings,
    }
  )

  const services: ServiceSet = {
    projects: createProjectsService(repositories, transaction),
    documents: createDocumentsService(repositories, transaction, aiSettings, {
      onDocumentContentStored: (documentId) => embeddingIndex.enqueueDocument(documentId),
      onDocumentsContentStored: (documentIds) => embeddingIndex.enqueueDocuments(documentIds),
      onDocumentDeleted: (documentId) => embeddingIndex.deleteDocument(documentId),
    }),
    chats: createChatsService(repositories),
    aiSettings,
    indexingSettings,
    embeddingIndex,
    auth: createAuthService(repositories, transaction),
  }

  return { connection, transaction, repositories, services }
}
