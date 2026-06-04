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

async function enqueueProjectDocuments(ctx: AppContext, projectId: string): Promise<void> {
  const documents = await ctx.services.documents.listForProject(projectId)
  await ctx.services.embeddingIndex.enqueueDocuments(documents.map((document) => document.id))
}

async function enqueueAllDocuments(ctx: AppContext): Promise<void> {
  const documentIds = await ctx.services.documents.listAllIds()
  await ctx.services.embeddingIndex.enqueueDocuments(documentIds)
}

async function enqueueProjectsOwnedByUser(ctx: AppContext, userId: string): Promise<void> {
  const projects = await ctx.services.projects.listOwnedByUser(userId)
  await Promise.all(projects.map((project) => enqueueProjectDocuments(ctx, project.id)))
}

export const embeddingModelSelectionRouter = router({
  availableProviders: protectedProcedure.query(async ({ ctx }) => {
    return ctx.services.embeddingModelSelection.getAvailableProviders()
  }),

  getGlobal: adminProcedure.query(async ({ ctx }) => {
    return ctx.services.embeddingModelSelection.getGlobal()
  }),

  updateGlobal: adminProcedure
    .input(z.object({ providerConfigId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const snapshot = await ctx.services.embeddingModelSelection.updateGlobal(
        input.providerConfigId
      )
      await enqueueAllDocuments(ctx)
      return snapshot
    }),

  getUser: protectedProcedure.query(async ({ ctx }) => {
    return ctx.services.embeddingModelSelection.getUserSnapshot(ctx.user.id)
  }),

  updateUser: protectedProcedure
    .input(z.object({ providerConfigId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const snapshot = await ctx.services.embeddingModelSelection.updateUserStrategy(
        ctx.user.id,
        input.providerConfigId
      )
      await enqueueProjectsOwnedByUser(ctx, ctx.user.id)
      return snapshot
    }),

  getProject: protectedProcedure
    .input(z.object({ projectId: idSchema }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const snapshot = await ctx.services.embeddingModelSelection.getProjectSnapshot(
        input.projectId
      )
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
      const snapshot = await ctx.services.embeddingModelSelection.updateProjectStrategy(
        input.projectId,
        input.providerConfigId
      )
      if (!snapshot) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Project ${input.projectId} not found`,
        })
      }

      await enqueueProjectDocuments(ctx, input.projectId)
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
      const snapshot = await ctx.services.embeddingModelSelection.getDocumentSnapshot(
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
      const snapshot = await ctx.services.embeddingModelSelection.updateDocumentStrategy(
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

      await ctx.services.embeddingIndex.enqueueDocument(input.id)
      return snapshot
    }),
})
