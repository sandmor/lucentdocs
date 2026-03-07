import type { ProjectsService } from './projects.service.js'
import type { DocumentsService } from './documents.service.js'
import type { ChatsService } from './chats.service.js'
import type { AiSettingsService } from './aiSettings.service.js'
import type { EmbeddingIndexService } from './embeddingIndex.service.js'
import type { AuthService } from './auth.service.js'
import type { IndexingSettingsService } from './indexingSettings.service.js'

export interface ServiceSet {
  projects: ProjectsService
  documents: DocumentsService
  chats: ChatsService
  aiSettings: AiSettingsService
  indexingSettings: IndexingSettingsService
  embeddingIndex: EmbeddingIndexService
  auth: AuthService
}
