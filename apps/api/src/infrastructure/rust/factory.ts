import type { NativeStorageEngine } from '@lucentdocs/core'
import type { RepositorySet } from '../../core/ports/types.js'
import type { ServiceSet } from '../../core/services/types.js'
import type { TransactionPort } from '../../core/ports/transaction.port.js'
import type { JobQueuePort } from '../../core/ports/jobQueue.port.js'
import type { DocumentEmbeddingsRepositoryPort } from '../../core/ports/documentEmbeddings.port.js'
import type { DocumentEmbeddingMetadataStorePort } from '../../core/ports/documentEmbeddingMetadata.port.js'
import { createCoreServiceSet } from '../../core/services/service-set.factory.js'
import { configManager } from '../../config/runtime.js'
import { openRustStorage } from './engine.js'
import { createTransaction } from './transaction.js'
import { RustJobQueueAdapter } from './jobQueue.adapter.js'
import { ProjectsRepository } from './projects.adapter.js'
import { DocumentsRepository } from './documents.adapter.js'
import { ProjectDocumentsRepository } from './projectDocuments.adapter.js'
import { ChatsRepository } from './chats.adapter.js'
import { VersionSnapshotsRepository } from './versionSnapshots.adapter.js'
import { YjsDocumentsRepository } from './yjsDocuments.adapter.js'
import { DocumentContentRepository } from './documentContent.adapter.js'
import { DocumentNotesRepository } from './documentNotes.adapter.js'
import { AiSettingsRepository } from './aiSettings.adapter.js'
import { AiModelSelectionRepository } from './aiModelSelection.adapter.js'
import { IndexingSettingsRepository } from './indexingSettings.adapter.js'
import { DocumentEmbeddingsRepository } from './documentEmbeddings.adapter.js'
import { EmbeddingIndexQueueRepository } from './embeddingIndexQueue.adapter.js'
import { AuthDataRepository } from './authData.adapter.js'
import { RustDocumentEmbeddingMetadataStore } from './documentEmbeddingMetadataStore.adapter.js'

export interface RustAdapter {
  engine: NativeStorageEngine
  transaction: TransactionPort
  jobQueue: JobQueuePort
  metadataStores: {
    documentEmbeddings: DocumentEmbeddingMetadataStorePort
  }
  repositories: RepositorySet
  services: ServiceSet
}

export interface CreateRustAdapterOptions {
  createDocumentEmbeddings?: (dependencies: {
    engine: NativeStorageEngine
    metadataStore: DocumentEmbeddingMetadataStorePort
  }) => DocumentEmbeddingsRepositoryPort
}

export function createRustAdapterFromEngine(
  engine: NativeStorageEngine,
  options: CreateRustAdapterOptions = {}
): RustAdapter {
  const transaction = createTransaction(engine)
  const jobQueue = new RustJobQueueAdapter(engine, transaction)
  const metadataStore = new RustDocumentEmbeddingMetadataStore(engine)
  const documentEmbeddings =
    options.createDocumentEmbeddings?.({ engine, metadataStore }) ??
    new DocumentEmbeddingsRepository(engine)

  const repositories: RepositorySet = {
    projects: new ProjectsRepository(engine),
    documents: new DocumentsRepository(engine),
    projectDocuments: new ProjectDocumentsRepository(engine),
    chats: new ChatsRepository(engine),
    versionSnapshots: new VersionSnapshotsRepository(engine),
    yjsDocuments: new YjsDocumentsRepository(engine),
    documentContent: new DocumentContentRepository(engine),
    documentNotes: new DocumentNotesRepository(engine),
    aiSettings: new AiSettingsRepository(engine),
    aiModelSelection: new AiModelSelectionRepository(engine),
    indexingSettings: new IndexingSettingsRepository(engine),
    embeddingIndexQueue: new EmbeddingIndexQueueRepository(jobQueue),
    documentEmbeddings,
    authData: new AuthDataRepository(engine),
  }

  const services = createCoreServiceSet({
    repositories,
    transaction,
    jobQueue,
    getEmbeddingRuntimeConfig: () => configManager.getConfig().embeddings,
  })

  return {
    engine,
    transaction,
    jobQueue,
    metadataStores: {
      documentEmbeddings: metadataStore,
    },
    repositories,
    services,
  }
}

export async function createRustAdapter(
  dbPath: string,
  options: CreateRustAdapterOptions = {}
): Promise<RustAdapter> {
  const engine = await openRustStorage(dbPath)
  return createRustAdapterFromEngine(engine, options)
}
