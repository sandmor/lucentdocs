import { Server as HttpServer, type IncomingMessage } from 'http'
import { WebSocketServer } from 'ws'
import { applyWSSHandler } from '@trpc/server/adapters/ws'
import { appRouter } from './router.js'
import type { AppContext } from './index.js'

type TrpcWsHandler = ReturnType<typeof applyWSSHandler<typeof appRouter>>

export interface TrpcWebSocketRuntime {
  wss: WebSocketServer
  handler: TrpcWsHandler
}

/**
 * Mounts tRPC websocket handling on the shared HTTP server without intercepting
 * unrelated upgrades such as the Yjs websocket endpoint.
 */
export function setupTrpcWebSocket(
  server: HttpServer,
  createContext: (options: { req: IncomingMessage }) => Promise<AppContext> | AppContext
): TrpcWebSocketRuntime {
  const wss = new WebSocketServer({ noServer: true })

  const handler = applyWSSHandler({
    wss,
    router: appRouter,
    createContext: (options) => createContext({ req: options.req }),
  })

  server.on('upgrade', (req, socket, head) => {
    const rawUrl = req.url
    if (!rawUrl) {
      socket.destroy()
      return
    }

    let pathname: string
    try {
      pathname = new URL(rawUrl, `http://${req.headers.host ?? 'localhost'}`).pathname
    } catch {
      socket.destroy()
      return
    }

    if (pathname !== '/api/trpc') {
      return
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })

  return { wss, handler }
}
