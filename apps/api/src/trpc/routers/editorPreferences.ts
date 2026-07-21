import { z } from 'zod/v4'
import { editorPreferenceOverridesSchema, isValidId } from '@lucentdocs/shared'
import { adminProcedure, protectedProcedure, router } from '../index.js'
import { assertProjectAccess } from '../access.js'

const id = z.string().min(1).max(128).refine(isValidId)
export const editorPreferencesRouter = router({
  getUser: protectedProcedure.query(({ ctx }) =>
    ctx.services.editorPreferences.snapshot(ctx.user.id)
  ),
  updateUser: protectedProcedure
    .input(z.object({ overrides: editorPreferenceOverridesSchema }))
    .mutation(({ ctx, input }) => {
      ctx.services.editorPreferences.update('user', ctx.user.id, input.overrides)
      return ctx.services.editorPreferences.snapshot(ctx.user.id)
    }),
  getProject: protectedProcedure
    .input(z.object({ projectId: id }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      return ctx.services.editorPreferences.snapshot(ctx.user.id, input.projectId)
    }),
  updateProject: protectedProcedure
    .input(z.object({ projectId: id, overrides: editorPreferenceOverridesSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      ctx.services.editorPreferences.update('project', input.projectId, input.overrides)
      return ctx.services.editorPreferences.snapshot(ctx.user.id, input.projectId)
    }),
  getDocument: protectedProcedure
    .input(z.object({ projectId: id, id }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      if (!(await ctx.services.documents.hasProjectAssociation(input.projectId, input.id))) {
        throw new Error('Document not found in project')
      }
      return ctx.services.editorPreferences.snapshot(ctx.user.id, input.projectId, input.id)
    }),
  updateDocument: protectedProcedure
    .input(z.object({ projectId: id, id, overrides: editorPreferenceOverridesSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      if (!(await ctx.services.documents.hasProjectAssociation(input.projectId, input.id))) {
        throw new Error('Document not found in project')
      }
      ctx.services.editorPreferences.update('document', input.id, input.overrides)
      return ctx.services.editorPreferences.snapshot(ctx.user.id, input.projectId, input.id)
    }),
  getGlobal: adminProcedure.query(({ ctx }) =>
    ctx.services.editorPreferences.snapshot(ctx.user.id)
  ),
  updateGlobal: adminProcedure
    .input(z.object({ overrides: editorPreferenceOverridesSchema }))
    .mutation(({ ctx, input }) => {
      ctx.services.editorPreferences.update('global', 'global', input.overrides)
      return ctx.services.editorPreferences.snapshot(ctx.user.id)
    }),
})
