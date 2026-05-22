import { TRPCError } from '@trpc/server'
import { z } from 'zod/v4'
import { isValidId } from '@lucentdocs/shared'
import { adminProcedure, protectedProcedure, router, type AppContext } from '../index.js'
import { assertProjectAccess } from '../access.js'

const idSchema = z.string().min(1).max(128).refine(isValidId, { message: 'Invalid ID format' })

async function ensureDocumentInProject(
  ctx: AppContext,
  projectId: string,
  documentId: string
): Promise<void> {
  const isAssociated = await ctx.services.documents.hasProjectAssociation(projectId, documentId)
  if (!isAssociated) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Document ${documentId} not found in project ${projectId}`,
    })
  }
}

export const aiModelSelectionRouter = router({
  availableProviders: protectedProcedure.query(async ({ ctx }) => {
    return ctx.services.aiModelSelection.getAvailableGenerationProviders()
  }),

  getGlobal: adminProcedure.query(async ({ ctx }) => {
    return ctx.services.aiModelSelection.getGlobal()
  }),

  updateGlobal: adminProcedure
    .input(z.object({ providerConfigId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const snapshot = await ctx.services.aiModelSelection.updateGlobal(input.providerConfigId)
      return snapshot
    }),

  getUser: protectedProcedure.query(async ({ ctx }) => {
    return ctx.services.aiModelSelection.getUserSnapshot(ctx.user.id)
  }),

  updateUser: protectedProcedure
    .input(z.object({ providerConfigId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const snapshot = await ctx.services.aiModelSelection.updateUserStrategy(
        ctx.user.id,
        input.providerConfigId
      )
      return snapshot
    }),

  getProject: protectedProcedure
    .input(z.object({ projectId: idSchema }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const snapshot = await ctx.services.aiModelSelection.getProjectSnapshot(input.projectId)
      if (!snapshot) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Project ${input.projectId} not found`,
        })
      }
      return snapshot
    }),

  updateProject: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        providerConfigId: z.string().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const snapshot = await ctx.services.aiModelSelection.updateProjectStrategy(
        input.projectId,
        input.providerConfigId
      )
      if (!snapshot) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Project ${input.projectId} not found`,
        })
      }
      return snapshot
    }),

  getDocument: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        id: idSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      await ensureDocumentInProject(ctx, input.projectId, input.id)
      const snapshot = await ctx.services.aiModelSelection.getDocumentSnapshot(
        input.id,
        input.projectId
      )
      if (!snapshot) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Document ${input.id} not found`,
        })
      }
      return snapshot
    }),

  updateDocument: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        id: idSchema,
        providerConfigId: z.string().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      await ensureDocumentInProject(ctx, input.projectId, input.id)
      const snapshot = await ctx.services.aiModelSelection.updateDocumentStrategy(
        input.id,
        input.providerConfigId,
        input.projectId
      )
      if (!snapshot) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Document ${input.id} not found`,
        })
      }
      return snapshot
    }),
})
