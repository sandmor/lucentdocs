import { initTRPC, TRPCError } from '@trpc/server'
import superjson from 'superjson'
import type { ServiceSet } from '../core/services/types.js'
import type { YjsRuntime } from '../yjs/runtime.js'
import type { ChatRuntime } from '../chat/runtime.js'
import type { InlineRuntime } from '../inline/runtime.js'
import type { EmbeddingRuntime } from '../embeddings/runtime.js'
import type { User } from '../core/models/user.js'
import type { AuthPort } from '../core/ports/auth.port.js'
import type { Request } from 'express'

export interface AppContext {
  req?: Request
  user: User | null
  services: ServiceSet
  authPort: AuthPort
  yjsRuntime: YjsRuntime
  embeddingRuntime: EmbeddingRuntime
  chatRuntime: ChatRuntime
  inlineRuntime: InlineRuntime
}

const t = initTRPC.context<AppContext>().create({
  transformer: superjson,
})

export const router = t.router
export const publicProcedure = t.procedure
export const middleware = t.middleware

const isAuthed = t.middleware(({ ctx, next }) => {
  // The local adapter always returns a user (even if auth is disabled via config),
  // so `ctx.user` will only be null if auth is ENABLED and the session is missing/invalid.
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' })
  }
  return next({
    ctx: {
      user: ctx.user,
    },
  })
})

export const protectedProcedure = t.procedure.use(isAuthed)

const isAdmin = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' })
  }

  if (ctx.user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' })
  }

  return next({
    ctx: {
      user: ctx.user,
    },
  })
})

export const adminProcedure = t.procedure.use(isAdmin)
