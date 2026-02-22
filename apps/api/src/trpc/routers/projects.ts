import { z } from 'zod/v4'
import { TRPCError } from '@trpc/server'
import { router, publicProcedure } from '../index.js'
import { projectsRepo } from '../../db/index.js'
import { isValidId, type JsonObject, type JsonValue } from '@plotline/shared'
import { projectSyncBus } from '../project-sync.js'

const idSchema = z.string().min(1).max(128).refine(isValidId, { message: 'Invalid ID format' })
const titleSchema = z.string().trim().min(1).max(200)
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
)
const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema)

export const projectsRouter = router({
  list: publicProcedure.query(async () => {
    return projectsRepo.listProjects()
  }),

  get: publicProcedure.input(z.object({ id: idSchema })).query(async ({ input }) => {
    const project = await projectsRepo.getProject(input.id)
    if (!project) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Project ${input.id} not found`,
      })
    }
    return project
  }),

  create: publicProcedure.input(z.object({ title: titleSchema })).mutation(async ({ input }) => {
    const project = await projectsRepo.createProject(input.title)

    projectSyncBus.publish({
      type: 'project.created',
      projectId: project.id,
    })

    return project
  }),

  update: publicProcedure
    .input(
      z
        .object({
          id: idSchema,
          title: titleSchema.optional(),
          metadata: jsonObjectSchema.nullable().optional(),
        })
        .refine((value) => value.title !== undefined || value.metadata !== undefined, {
          message: 'At least one field must be provided',
          path: ['title'],
        })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input

      const project = await projectsRepo.updateProject(id, data)
      if (!project) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Project ${id} not found`,
        })
      }

      projectSyncBus.publish({
        type: 'project.updated',
        projectId: id,
      })

      return project
    }),

  delete: publicProcedure.input(z.object({ id: idSchema })).mutation(async ({ input }) => {
    const deleted = await projectsRepo.deleteProject(input.id)
    if (!deleted) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Project ${input.id} not found`,
      })
    }

    projectSyncBus.publish({
      type: 'project.deleted',
      projectId: input.id,
    })

    return { success: true }
  }),
})
