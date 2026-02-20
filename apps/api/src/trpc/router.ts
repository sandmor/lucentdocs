import { router } from './index.js'
import { projectsRouter } from './routers/projects.js'

export const appRouter = router({
  projects: projectsRouter,
})

export type AppRouter = typeof appRouter
