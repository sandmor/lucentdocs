import { z } from 'zod/v4'
import { TRPCError } from '@trpc/server'
import { adminProcedure, protectedProcedure, router } from '../index.js'
import { isValidId, type JsonObject, type JsonValue } from '@lucentdocs/shared'
import { assertProjectAccess } from '../access.js'
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
    if (ctx.user.role === 'admin') {
      return ctx.services.projects.list()
    }
    return ctx.services.projects.listOwnedByUser(ctx.user.id)
  }),

  get: protectedProcedure.input(z.object({ id: idSchema })).query(async ({ ctx, input }) => {
    return assertProjectAccess(ctx, input.id)
  }),

  create: protectedProcedure
    .input(z.object({ title: titleSchema }))
    .mutation(async ({ ctx, input }) => {
      const owner = await ctx.authPort.getUserById(ctx.user.id)
      if (!owner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `User ${ctx.user.id} cannot own a project`,
        })
      }

      const project = await ctx.services.projects.create(input.title, {
        ownerUserId: owner.id,
      })

      projectSyncBus.publish({
        audienceUserIds: [project.ownerUserId],
        type: 'project.created',
        projectId: project.id,
        ownerUserId: project.ownerUserId,
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
      await assertProjectAccess(ctx, id)

      const project = await ctx.services.projects.update(id, data)
      if (!project) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Project ${id} not found`,
        })
      }

      projectSyncBus.publish({
        audienceUserIds: [project.ownerUserId],
        type: 'project.updated',
        projectId: id,
        ownerUserId: project.ownerUserId,
      })

      return project
    }),

  reassignOwner: adminProcedure
    .input(
      z.object({
        id: idSchema,
        ownerEmail: z.string().trim().min(1).max(256),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const previous = await ctx.services.projects.getById(input.id)
      if (!previous) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Project ${input.id} not found`,
        })
      }

      const owner = await ctx.authPort.getUserByEmail(input.ownerEmail)
      if (!owner) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `User with email ${input.ownerEmail} not found`,
        })
      }

      const project = await ctx.services.projects.reassignOwner(input.id, owner.id)
      if (!project) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Project ${input.id} not found`,
        })
      }

      projectSyncBus.publish({
        audienceUserIds: [...new Set([previous.ownerUserId, project.ownerUserId])],
        type: 'project.updated',
        projectId: input.id,
        ownerUserId: project.ownerUserId,
      })

      return project
    }),

  delete: protectedProcedure.input(z.object({ id: idSchema })).mutation(async ({ ctx, input }) => {
    const project = await assertProjectAccess(ctx, input.id)
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
      audienceUserIds: [project.ownerUserId],
      type: 'project.deleted',
      projectId: input.id,
      ownerUserId: project.ownerUserId,
    })

    return { success: true }
  }),
})
