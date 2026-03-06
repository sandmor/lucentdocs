import { z } from 'zod/v4'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../index.js'
import { isValidId, type JsonObject, type JsonValue } from '@lucentdocs/shared'
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
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.services.projects.list()
  }),

  get: protectedProcedure.input(z.object({ id: idSchema })).query(async ({ ctx, input }) => {
    const project = await ctx.services.projects.getById(input.id)
    if (!project) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Project ${input.id} not found`,
      })
    }
    return project
  }),

  create: protectedProcedure
    .input(z.object({ title: titleSchema }))
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.services.projects.create(input.title)

      projectSyncBus.publish({
        type: 'project.created',
        projectId: project.id,
      })

      return project
    }),

  update: protectedProcedure
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
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input

      const project = await ctx.services.projects.update(id, data)
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

  delete: protectedProcedure.input(z.object({ id: idSchema })).mutation(async ({ ctx, input }) => {
    const scopedDocuments = await ctx.services.documents.listForProject(input.id)

    const deleted = await ctx.services.projects.delete(input.id)
    if (!deleted) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Project ${input.id} not found`,
      })
    }

    for (const document of scopedDocuments) {
      ctx.yjsRuntime.evictLiveDocument(document.id)
    }

    projectSyncBus.publish({
      type: 'project.deleted',
      projectId: input.id,
    })

    return { success: true }
  }),
})
