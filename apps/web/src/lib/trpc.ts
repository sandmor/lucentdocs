import { createTRPCReact } from '@trpc/react-query'
import {
  createTRPCProxyClient,
  createWSClient,
  httpBatchLink,
  splitLink,
  wsLink,
} from '@trpc/client'
import superjson from 'superjson'
import type { AppRouter } from '../../../api/src/trpc/router'

export const trpc = createTRPCReact<AppRouter>()
let browserProxyClient: ReturnType<typeof createTRPCProxyClient<AppRouter>> | null = null

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

export function getTrpcProxyClient() {
  if (typeof window === 'undefined') {
    return createTRPCProxyClient<AppRouter>({
      links: [
        httpBatchLink({
          url: '/api/trpc',
          transformer: superjson,
        }),
      ],
    })
  }

  if (browserProxyClient) {
    return browserProxyClient
  }

  const wsClient = createWSClient({
    url: createWsUrl(),
  })

  browserProxyClient = createTRPCProxyClient<AppRouter>({
    links: [
      splitLink({
        condition(op) {
          return op.type === 'subscription'
        },
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

  return browserProxyClient
}
