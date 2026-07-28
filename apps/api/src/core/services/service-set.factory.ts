import type { RepositorySet } from '../ports/types.js'
import type { TransactionPort } from '../ports/transaction.port.js'
import type { JobQueuePort } from '../ports/jobQueue.port.js'
import { createProjectsService } from './projects.service.js'
import { createDocumentsService } from './documents.service.js'
import { createChatsService } from './chats.service.js'
import { createAiSettingsService } from './aiSettings.service.js'
import {
  createAiModelSelectionService,
  createEmbeddingModelSelectionService,
} from './aiModelSelection.service.js'
import { createIndexingSettingsService } from './indexingSettings.service.js'
import { createDocumentNotesService } from './documentNotes.service.js'
import {
  createEmbeddingIndexService,
  type EmbeddingIndexRuntimeConfig,
} from './embeddingIndex.service.js'
import { createDocumentDeleteCleanupScheduler } from './document-delete-cleanup-scheduler.js'
import { createAuthService } from './auth.service.js'
import { createEditorPreferencesService } from './editorPreferences.service.js'
import { createAssistantPreferencesService } from './assistantPreferences.service.js'
import { createMcpSettingsService } from './mcpSettings.service.js'
import { createDocumentSharingService } from './documentSharing.service.js'
import type { ServiceSet } from './types.js'

export function createCoreServiceSet(dependencies: {
  repositories: RepositorySet
  transaction: TransactionPort
  jobQueue: JobQueuePort
  getEmbeddingRuntimeConfig?: () => EmbeddingIndexRuntimeConfig
}): ServiceSet {
  const aiSettings = createAiSettingsService(dependencies.repositories, dependencies.transaction)
  const aiModelSelection = createAiModelSelectionService(dependencies.repositories)
  const embeddingModelSelection = createEmbeddingModelSelectionService(dependencies.repositories)
  const indexingSettings = createIndexingSettingsService(dependencies.repositories)
  const mcpSettings = createMcpSettingsService(dependencies.repositories)
  const embeddingIndex = createEmbeddingIndexService(
    dependencies.repositories,
    dependencies.transaction,
    dependencies.jobQueue,
    aiSettings,
    indexingSettings,
    embeddingModelSelection,
    {
      getRuntimeConfig: dependencies.getEmbeddingRuntimeConfig,
    }
  )

  const documentDeleteCleanup = createDocumentDeleteCleanupScheduler({
    deleteDocuments: (documentIds, references) =>
      embeddingIndex.deleteDocuments(documentIds, { references }),
  })

  const documents = createDocumentsService(
    dependencies.repositories,
    dependencies.transaction,
    aiSettings,
    embeddingModelSelection,
    {
      onDocumentContentStored: (documentId) => embeddingIndex.enqueueDocument(documentId),
      onDocumentsContentStored: (documentIds) => embeddingIndex.enqueueDocuments(documentIds),
      onDocumentsDeleted: (documentIds, references) => {
        documentDeleteCleanup.schedule(documentIds, references)
      },
    }
  )

  const projects = createProjectsService(dependencies.repositories, dependencies.transaction, {
    deleteDocument: (id) => documents.delete(id),
  })

  return {
    projects,
    documents,
    documentSharing: createDocumentSharingService(
      dependencies.repositories,
      dependencies.transaction
    ),
    documentNotes: createDocumentNotesService(dependencies.repositories),
    chats: createChatsService(dependencies.repositories),
    aiSettings,
    aiModelSelection,
    embeddingModelSelection,
    indexingSettings,
    mcpSettings,
    embeddingIndex,
    auth: createAuthService(dependencies.repositories, dependencies.transaction),
    editorPreferences: createEditorPreferencesService(dependencies.repositories),
    assistantPreferences: createAssistantPreferencesService(dependencies.repositories),
  }
}
