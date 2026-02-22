import { router } from './index.js'
import { projectsRouter } from './routers/projects.js'
import { configRouter } from './routers/config.js'

export const appRouter = router({
  projects: projectsRouter,
  config: configRouter,
})

export type AppRouter = typeof appRouter
