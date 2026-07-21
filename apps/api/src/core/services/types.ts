import type { ProjectsService } from './projects.service.js'
import type { DocumentsService } from './documents.service.js'
import type { ChatsService } from './chats.service.js'
import type { AiSettingsService } from './aiSettings.service.js'
import type { AiModelSelectionService } from './aiModelSelection.service.js'
import type { AiProviderSelectionService } from './aiModelSelection.service.js'
import type { EmbeddingIndexService } from './embeddingIndex.service.js'
import type { AuthService } from './auth.service.js'
import type { IndexingSettingsService } from './indexingSettings.service.js'
import type { DocumentNotesService } from './documentNotes.service.js'
import { createEditorPreferencesService } from './editorPreferences.service.js'
import { createAssistantPreferencesService } from './assistantPreferences.service.js'

export interface ServiceSet {
  projects: ProjectsService
  documents: DocumentsService
  documentNotes: DocumentNotesService
  chats: ChatsService
  aiSettings: AiSettingsService
  aiModelSelection: AiModelSelectionService
  embeddingModelSelection: AiProviderSelectionService
  indexingSettings: IndexingSettingsService
  embeddingIndex: EmbeddingIndexService
  auth: AuthService
  editorPreferences: ReturnType<typeof createEditorPreferencesService>
  assistantPreferences: ReturnType<typeof createAssistantPreferencesService>
}
