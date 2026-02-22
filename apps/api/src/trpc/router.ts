import { router } from './index.js'
import { projectsRouter } from './routers/projects.js'
import { documentsRouter } from './routers/documents.js'
import { configRouter } from './routers/config.js'
import { promptsRouter } from './routers/prompts.js'

export const appRouter = router({
  projects: projectsRouter,
  documents: documentsRouter,
  config: configRouter,
  prompts: promptsRouter,
})

export type AppRouter = typeof appRouter
