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

  deletionPlan: protectedProcedure
    .input(z.object({ id: idSchema }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.id)
      const plan = await ctx.services.projects.getDeletionPlan(input.id)
      if (!plan)
        throw new TRPCError({ code: 'NOT_FOUND', message: `Project ${input.id} not found` })
      return plan
    }),

  delete: protectedProcedure
    .input(
      z.object({
        id: idSchema,
        resolutions: z
          .array(
            z.discriminatedUnion('action', [
              z.object({ documentId: idSchema, action: z.literal('delete') }),
              z.object({
                documentId: idSchema,
                action: z.literal('rehome'),
                projectId: idSchema,
                path: z.string().trim().min(1).max(512),
              }),
            ])
          )
          .default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await assertProjectAccess(ctx, input.id)
      const plan = await ctx.services.projects.getDeletionPlan(input.id)
      if (!plan) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Project ${input.id} not found`,
        })
      }
      if (plan.homeDocuments.length > 0 && input.resolutions.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Resolve every home document before deleting this project',
        })
      }
      const result = await ctx.services.projects.deleteWithPlan({
        projectId: input.id,
        targetOwnerUserId: project.ownerUserId,
        resolutions: input.resolutions,
      })
      if (!result)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The deletion plan is no longer valid',
        })

      for (const document of result.deletedDocumentIds) {
        ctx.yjsRuntime.evictLiveDocument(document)
      }
      projectSyncBus.publish({
        audienceUserIds: [project.ownerUserId],
        type: 'project.deleted',
        projectId: input.id,
        ownerUserId: project.ownerUserId,
      })

      return { success: true, ...result }
    }),
})
