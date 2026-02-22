import { createTRPCReact } from '@trpc/react-query'
import { createWSClient, httpBatchLink, splitLink, wsLink } from '@trpc/client'
import superjson from 'superjson'
import type { AppRouter } from '../../../api/src/trpc/router'

export const trpc = createTRPCReact<AppRouter>()

function createWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}/api/trpc`
}

export function createTRPCClient() {
  if (typeof window === 'undefined') {
    return trpc.createClient({
      links: [
        httpBatchLink({
          url: '/api/trpc',
          transformer: superjson,
        }),
      ],
    })
  }

  const wsClient = createWSClient({ url: createWsUrl() })

  return trpc.createClient({
    links: [
      splitLink({
        condition: (op) => op.type === 'subscription',
        true: wsLink({
          client: wsClient,
          transformer: superjson,
        }),
        false: httpBatchLink({
          url: '/api/trpc',
          transformer: superjson,
        }),
      }),
    ],
  })
}
