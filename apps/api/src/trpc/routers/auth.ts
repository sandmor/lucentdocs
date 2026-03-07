import { z } from 'zod'
import { authPasswordSchema } from '@lucentdocs/shared'
import { adminProcedure, publicProcedure, router } from '../index.js'
import { TRPCError } from '@trpc/server'
import { readSessionToken, setSessionCookie, clearSessionCookie } from '../../http/auth.js'
import type { Request } from 'express'

export const authLoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1, 'Password is required'),
})

export const authSignupSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.email(),
  password: authPasswordSchema,
  invitationToken: z.string().min(1, 'Invitation token is required'),
})

const invitationTokenSchema = z.object({
  token: z.string().min(1),
})

const createInvitationSchema = z.object({
  email: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value.toLowerCase() : undefined))
    .refine((value) => !value || z.email().safeParse(value).success, 'Invalid email.'),
  role: z.enum(['admin', 'user']).default('user'),
  expiresInDays: z.number().int().min(1).max(365).default(7),
})

const invitationIdSchema = z.object({
  id: z.string().min(1),
})

const userIdSchema = z.object({
  userId: z.string().min(1),
})

function requireHttpRequest(req: Request | undefined): Request {
  if (!req) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'This auth endpoint requires HTTP request context.',
    })
  }

  return req
}

export const authRouter = router({
  me: publicProcedure.query(({ ctx }) => {
    return ctx.user
  }),

  signupInvitation: publicProcedure.input(invitationTokenSchema).query(async ({ ctx, input }) => {
    const invitation = await ctx.services.auth.getValidInvitationByToken(input.token)
    if (!invitation) return null
    return {
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    }
  }),

  login: publicProcedure.input(authLoginSchema).mutation(async ({ ctx, input }) => {
    const req = requireHttpRequest(ctx.req)

    if (!ctx.authPort.isEnabled()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Authentication is disabled.' })
    }

    const result = await ctx.authPort.login(input.email, input.password)

    if (!result.success) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: result.error || 'Invalid email or password',
      })
    }

    setSessionCookie(req, result.token, result.expiresAt)

    return { success: true }
  }),

  signup: publicProcedure.input(authSignupSchema).mutation(async ({ ctx, input }) => {
    const req = requireHttpRequest(ctx.req)

    if (!ctx.authPort.isEnabled()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Authentication is disabled.' })
    }

    const result = await ctx.authPort.signup({
      name: input.name,
      email: input.email,
      password: input.password,
      invitationToken: input.invitationToken,
    })

    if (!result.success) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: result.error || 'Failed to register',
      })
    }

    setSessionCookie(req, result.token, result.expiresAt)

    return { success: true }
  }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    const req = requireHttpRequest(ctx.req)
    const token = readSessionToken(req)
    if (token) {
      await ctx.authPort.logout(token)
    }
    clearSessionCookie(req)

    return { success: true }
  }),

  listUsers: adminProcedure.query(async ({ ctx }) => {
    return ctx.services.auth.listUsers()
  }),

  getUser: adminProcedure.input(userIdSchema).query(async ({ ctx, input }) => {
    const users = await ctx.services.auth.listUsers()
    return users.find((user) => user.id === input.userId) ?? null
  }),

  deleteUser: adminProcedure.input(userIdSchema).mutation(async ({ ctx, input }) => {
    await ctx.services.auth.deleteUser(input.userId, ctx.user.id)
    return { success: true }
  }),

  listInvitations: adminProcedure.query(async ({ ctx }) => {
    return ctx.services.auth.listInvitations()
  }),

  createInvitation: adminProcedure
    .input(createInvitationSchema)
    .mutation(async ({ ctx, input }) => {
      const now = Date.now()
      const expiresAt = now + input.expiresInDays * 24 * 60 * 60 * 1000
      const invitation = await ctx.services.auth.createInvitation({
        email: input.email ?? null,
        role: input.role,
        expiresAt,
        createdByUserId: ctx.user.id,
      })

      return {
        ...invitation,
        inviteUrl: `/signup?invite=${encodeURIComponent(invitation.token)}`,
      }
    }),

  revokeInvitation: adminProcedure.input(invitationIdSchema).mutation(async ({ ctx, input }) => {
    await ctx.services.auth.revokeInvitation(input.id)
    return { success: true }
  }),
})
