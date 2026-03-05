import type { ProjectsRepositoryPort } from './projects.port.js'
import type { DocumentsRepositoryPort } from './documents.port.js'
import type { ProjectDocumentsRepositoryPort } from './projectDocuments.port.js'
import type { ChatsRepositoryPort } from './chats.port.js'
import type { VersionSnapshotsRepositoryPort } from './versionSnapshots.port.js'
import type { YjsDocumentsRepositoryPort } from './yjsDocuments.port.js'
import type { AiSettingsRepositoryPort } from './aiSettings.port.js'

export interface RepositorySet {
  projects: ProjectsRepositoryPort
  documents: DocumentsRepositoryPort
  projectDocuments: ProjectDocumentsRepositoryPort
  chats: ChatsRepositoryPort
  versionSnapshots: VersionSnapshotsRepositoryPort
  yjsDocuments: YjsDocumentsRepositoryPort
  aiSettings: AiSettingsRepositoryPort
}
