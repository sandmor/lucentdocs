import { z } from 'zod/v4'
import { assistantPreferenceOverridesSchema, isValidId } from '@lucentdocs/shared'
import { adminProcedure, protectedProcedure, router } from '../index.js'
import { assertProjectAccess } from '../access.js'

const id = z.string().min(1).max(128).refine(isValidId)

export const assistantPreferencesRouter = router({
  getUser: protectedProcedure.query(({ ctx }) => ctx.services.assistantPreferences.snapshot(ctx.user.id)),
  updateUser: protectedProcedure.input(z.object({ overrides: assistantPreferenceOverridesSchema })).mutation(async ({ ctx, input }) => {
    await ctx.services.assistantPreferences.update('user', ctx.user.id, input.overrides)
    return ctx.services.assistantPreferences.snapshot(ctx.user.id)
  }),
  getProject: protectedProcedure.input(z.object({ projectId: id })).query(async ({ ctx, input }) => {
    await assertProjectAccess(ctx, input.projectId)
    return ctx.services.assistantPreferences.snapshot(ctx.user.id, input.projectId)
  }),
  updateProject: protectedProcedure.input(z.object({ projectId: id, overrides: assistantPreferenceOverridesSchema })).mutation(async ({ ctx, input }) => {
    await assertProjectAccess(ctx, input.projectId)
    await ctx.services.assistantPreferences.update('project', input.projectId, input.overrides)
    return ctx.services.assistantPreferences.snapshot(ctx.user.id, input.projectId)
  }),
  getGlobal: adminProcedure.query(({ ctx }) => ctx.services.assistantPreferences.snapshot(ctx.user.id)),
  updateGlobal: adminProcedure.input(z.object({ overrides: assistantPreferenceOverridesSchema })).mutation(async ({ ctx, input }) => {
    await ctx.services.assistantPreferences.update('global', 'global', input.overrides)
    return ctx.services.assistantPreferences.snapshot(ctx.user.id)
  }),
})
