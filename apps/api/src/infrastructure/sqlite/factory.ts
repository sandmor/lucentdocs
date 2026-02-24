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
import { createProjectsService } from '../../core/services/projects.service.js'
import { createDocumentsService } from '../../core/services/documents.service.js'
import { createChatsService } from '../../core/services/chats.service.js'

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
  }

  const services: ServiceSet = {
    projects: createProjectsService(repositories, transaction),
    documents: createDocumentsService(repositories, transaction),
    chats: createChatsService(repositories),
  }

  return { connection, transaction, repositories, services }
}
