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

export const appRouter = router({
  projects: projectsRouter,
  documents: documentsRouter,
  config: configRouter,
  prompts: promptsRouter,
  sync: syncRouter,
  chat: chatRouter,
  inline: inlineRouter,
  auth: authRouter,
  indexing: indexingRouter,
})

export type AppRouter = typeof appRouter
