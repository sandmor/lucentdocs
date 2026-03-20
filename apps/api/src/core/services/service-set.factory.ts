import type { RepositorySet } from '../ports/types.js'
import type { TransactionPort } from '../ports/transaction.port.js'
import type { JobQueuePort } from '../ports/jobQueue.port.js'
import { createProjectsService } from './projects.service.js'
import { createDocumentsService } from './documents.service.js'
import { createChatsService } from './chats.service.js'
import { createAiSettingsService } from './aiSettings.service.js'
import { createIndexingSettingsService } from './indexingSettings.service.js'
import {
  createEmbeddingIndexService,
  type EmbeddingIndexRuntimeConfig,
} from './embeddingIndex.service.js'
import { createDocumentDeleteCleanupScheduler } from './document-delete-cleanup-scheduler.js'
import { createAuthService } from './auth.service.js'
import type { ServiceSet } from './types.js'

export function createCoreServiceSet(dependencies: {
  repositories: RepositorySet
  transaction: TransactionPort
  jobQueue: JobQueuePort
  getEmbeddingRuntimeConfig?: () => EmbeddingIndexRuntimeConfig
}): ServiceSet {
  const aiSettings = createAiSettingsService(dependencies.repositories, dependencies.transaction)
  const indexingSettings = createIndexingSettingsService(dependencies.repositories)
  const embeddingIndex = createEmbeddingIndexService(
    dependencies.repositories,
    dependencies.transaction,
    dependencies.jobQueue,
    aiSettings,
    indexingSettings,
    {
      getRuntimeConfig: dependencies.getEmbeddingRuntimeConfig,
    }
  )

  const documentDeleteCleanup = createDocumentDeleteCleanupScheduler({
    deleteDocuments: (documentIds, references) =>
      embeddingIndex.deleteDocuments(documentIds, { references }),
  })

  return {
    projects: createProjectsService(dependencies.repositories, dependencies.transaction, {
      onDocumentsDeleted: (documentIds, references) => {
        documentDeleteCleanup.schedule(documentIds, references)
      },
    }),
    documents: createDocumentsService(
      dependencies.repositories,
      dependencies.transaction,
      aiSettings,
      {
        onDocumentContentStored: (documentId) => embeddingIndex.enqueueDocument(documentId),
        onDocumentsContentStored: (documentIds) => embeddingIndex.enqueueDocuments(documentIds),
        onDocumentsDeleted: (documentIds, references) => {
          documentDeleteCleanup.schedule(documentIds, references)
        },
      }
    ),
    chats: createChatsService(dependencies.repositories),
    aiSettings,
    indexingSettings,
    embeddingIndex,
    auth: createAuthService(dependencies.repositories, dependencies.transaction),
  }
}
