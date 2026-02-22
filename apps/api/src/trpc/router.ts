import { router } from './index.js'
import { projectsRouter } from './routers/projects.js'
import { configRouter } from './routers/config.js'
import { promptsRouter } from './routers/prompts.js'

export const appRouter = router({
  projects: projectsRouter,
  config: configRouter,
  prompts: promptsRouter,
})

export type AppRouter = typeof appRouter
