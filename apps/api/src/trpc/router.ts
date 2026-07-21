import { router } from './index.js'
import { projectsRouter } from './routers/projects.js'
import { documentsRouter } from './routers/documents.js'
import { configRouter } from './routers/config.js'
import { promptsRouter } from './routers/prompts.js'
import { syncRouter } from './routers/sync.js'
import { chatRouter } from './routers/chat.js'
import { inlineRouter } from './routers/inline.js'
import { authRouter } from './routers/auth.js'
import { indexingRouter } from './routers/indexing.js'
import { aiModelSelectionRouter } from './routers/aiModelSelection.js'
import { embeddingModelSelectionRouter } from './routers/embeddingModelSelection.js'
import { editorPreferencesRouter } from './routers/editorPreferences.js'
import { assistantPreferencesRouter } from './routers/assistantPreferences.js'

export const appRouter = router({
  projects: projectsRouter,
  documents: documentsRouter,
  config: configRouter,
  prompts: promptsRouter,
  sync: syncRouter,
  chat: chatRouter,
  assistant: chatRouter,
  inline: inlineRouter,
  auth: authRouter,
  indexing: indexingRouter,
  aiModelSelection: aiModelSelectionRouter,
  embeddingModelSelection: embeddingModelSelectionRouter,
  editorPreferences: editorPreferencesRouter,
  assistantPreferences: assistantPreferencesRouter,
})

export type AppRouter = typeof appRouter
