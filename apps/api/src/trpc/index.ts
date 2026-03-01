import { initTRPC } from '@trpc/server'
import superjson from 'superjson'
import type { ServiceSet } from '../core/services/types.js'
import type { YjsRuntime } from '../yjs/runtime.js'
import type { ChatRuntime } from '../chat/runtime.js'
import type { InlineRuntime } from '../inline/runtime.js'

export interface AppContext {
  services: ServiceSet
  yjsRuntime: YjsRuntime
  chatRuntime: ChatRuntime
  inlineRuntime: InlineRuntime
}

const t = initTRPC.context<AppContext>().create({
  transformer: superjson,
})

export const router = t.router
export const publicProcedure = t.procedure
export const middleware = t.middleware
