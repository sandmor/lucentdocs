import express from 'express'
import path from 'path'
import fs from 'fs'
import { type Express } from 'express'
import { createServer as createHttpServer, type Server as HttpServer } from 'http'
import { type Socket } from 'net'
import { createServer as createViteServer, type ViteDevServer } from 'vite'
import { createExpressMiddleware } from '@trpc/server/adapters/express'
import cookieParser from 'cookie-parser'
import { type WebSocketServer } from 'ws'
import { appRouter } from './trpc/router.js'
import type { AppContext } from './trpc/index.js'
import { PROJECT_ROOT } from './paths.js'
import { configManager } from './config/manager.js'
import { registerAiTextStreamRoute } from './http/ai-stream.js'
import { setupYjsWebSocket } from './yjs/websocket-handler.js'
import { setupTrpcWebSocket, type TrpcWebSocketRuntime } from './trpc/websocket.js'
import { createContainer } from './app/container.js'

const appConfig = configManager.getConfig()
const isProd = appConfig.runtime.isProduction
const isTestRuntime = appConfig.runtime.nodeEnv === 'test' || process.env.PLOTLINE_TEST_MODE === '1'
const container = createContainer(appConfig.paths.dbFile, {
  persistenceFlushIntervalMs: appConfig.yjs.persistenceFlushIntervalMs,
  versionSnapshotIntervalMs: appConfig.yjs.versionSnapshotIntervalMs,
})

container.yjsRuntime.initialize()

function createTprcContext(): AppContext {
  return {
    services: container.services,
    yjsRuntime: container.yjsRuntime,
    chatRuntime: container.chatRuntime,
  }
}

function displayHostForLog(bindHost: string): string {
  if (bindHost === '0.0.0.0' || bindHost === '::') return 'localhost'
  return bindHost.includes(':') ? `[${bindHost}]` : bindHost
}

const port = appConfig.server.port
const host = appConfig.server.host
const WEB_ROOT = path.join(PROJECT_ROOT, 'apps/web')

function registerMetaRoutes(app: Express): void {
  app.get('/.well-known/{*path}', (_req, res) => {
    res.status(204).end()
  })
}

function registerTrpcRoutes(app: Express): void {
  app.use(
    '/api/trpc',
    createExpressMiddleware({ router: appRouter, createContext: createTprcContext })
  )
}

function resolveTheme(value: unknown): 'light' | 'dark' {
  return value === 'dark' ? 'dark' : 'light'
}

function applyHtmlThemeClass(template: string, theme: 'light' | 'dark'): string {
  if (template.includes('<html')) {
    if (/<html[^>]*class=["'][^"']*["'][^>]*>/i.test(template)) {
      return template.replace(
        /<html([^>]*)class=["'][^"']*["']([^>]*)>/i,
        `<html$1class="${theme}"$2>`
      )
    }

    return template.replace(/<html([^>]*)>/i, `<html$1 class="${theme}">`)
  }

  return template
}

async function setupWebRuntime(app: Express): Promise<ViteDevServer | null> {
  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: isTestRuntime ? false : undefined,
        ws: isTestRuntime ? false : undefined,
      },
      appType: 'custom',
      root: WEB_ROOT,
    })
    app.use(vite.middlewares)
    return vite
  }

  const compression = (await import('compression')).default
  const sirv = (await import('sirv')).default
  app.use(compression())
  app.use('/', sirv(path.join(WEB_ROOT, 'dist/client'), { extensions: [] }))
  return null
}

function registerSsrRoute(app: Express, vite: ViteDevServer | null): void {
  app.use('{*path}', async (req, res) => {
    try {
      const url = req.originalUrl
      let template: string
      let render: (requestUrl: string) => Promise<string> | string

      if (!isProd) {
        template = fs.readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf-8')
        template = await vite!.transformIndexHtml(url, template)
        render = (await vite!.ssrLoadModule('/src/entry-server.tsx')).render
      } else {
        template = fs.readFileSync(path.join(WEB_ROOT, 'dist/client/index.html'), 'utf-8')
        const serverEntryPoint = path.join(WEB_ROOT, 'dist/server/entry-server.js')
        render = (await import(serverEntryPoint)).render
      }

      const appHtml = await render(url)
      const theme = resolveTheme(req.cookies.theme)
      const html = template.replace('<!--app-html-->', appHtml)
      const themedHtml = applyHtmlThemeClass(html, theme)

      res.status(200).set({ 'Content-Type': 'text/html' }).end(themedHtml)
    } catch (error: unknown) {
      if (error instanceof Response) {
        const body = await error.text()
        res.status(error.status).set({ 'Content-Type': 'text/plain; charset=utf-8' }).end(body)
        return
      }

      if (!isProd) {
        vite?.ssrFixStacktrace(error as Error)
      }
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
      console.error(message)
      res.status(500).end(message)
    }
  })
}

function registerProcessHandlers(
  server: HttpServer,
  options: {
    vite: ViteDevServer | null
    yjsWss: WebSocketServer
    trpcWs: TrpcWebSocketRuntime
    sockets: Set<Socket>
  }
): void {
  let shuttingDown = false

  const forceExit = (exitCode: number) => {
    for (const socket of options.sockets) {
      socket.destroy()
    }
    process.exit(exitCode)
  }

  const shutdown = () => {
    if (shuttingDown) {
      console.warn('Shutdown already in progress, forcing exit.')
      forceExit(1)
      return
    }

    shuttingDown = true

    console.log('Shutting down...')
    container.yjsRuntime.stopSnapshotTimer()
    container.yjsRuntime.stopPersistenceFlushLoop()

    const forceShutdownTimer = setTimeout(() => {
      console.error('Graceful shutdown timed out, forcing exit.')
      forceExit(1)
    }, 5000)
    if (typeof forceShutdownTimer.unref === 'function') {
      forceShutdownTimer.unref()
    }

    void container.yjsRuntime
      .flushAllDocumentStates()
      .catch((error) => {
        console.error('Failed to flush Yjs documents on shutdown:', error)
      })
      .then(async () => {
        options.trpcWs.handler.broadcastReconnectNotification()
        for (const client of options.trpcWs.wss.clients) {
          client.terminate()
        }

        await new Promise<void>((resolve) => {
          options.trpcWs.wss.close(() => resolve())
        })

        for (const client of options.yjsWss.clients) {
          client.terminate()
        }

        await new Promise<void>((resolve) => {
          options.yjsWss.close(() => resolve())
        })

        if (options.vite) {
          await options.vite.close()
        }

        await new Promise<void>((resolve) => {
          server.close((error) => {
            if (error) {
              console.error('Failed to close HTTP server:', error)
            }
            resolve()
          })

          const serverWithHelpers = server as HttpServer & {
            closeAllConnections?: () => void
            closeIdleConnections?: () => void
          }
          serverWithHelpers.closeIdleConnections?.()
          serverWithHelpers.closeAllConnections?.()
        })

        clearTimeout(forceShutdownTimer)
        process.exit(0)
      })
      .catch((error) => {
        clearTimeout(forceShutdownTimer)
        console.error('Failed to shut down cleanly:', error)
        forceExit(1)
      })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

async function startServer() {
  const app = express()
  app.use(express.json({ limit: '10mb' }))
  app.use(cookieParser())

  registerMetaRoutes(app)
  registerAiTextStreamRoute(app, container.services)
  registerTrpcRoutes(app)

  const vite = await setupWebRuntime(app)
  registerSsrRoute(app, vite)

  const httpServer = createHttpServer(app)
  const sockets = new Set<Socket>()
  httpServer.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => {
      sockets.delete(socket)
    })
  })

  const yjsWss = setupYjsWebSocket(httpServer, container.yjsRuntime)
  const trpcWs = setupTrpcWebSocket(httpServer, createTprcContext)
  container.yjsRuntime.startSnapshotTimer()

  yjsWss.on('error', (error) => {
    console.error('Yjs websocket server error:', error)
  })
  trpcWs.wss.on('error', (error) => {
    console.error('tRPC websocket server error:', error)
  })
  httpServer.on('error', (error) => {
    console.error(`Failed to start HTTP server on ${host}:${port}:`, error)
    process.exit(1)
  })

  httpServer.listen(port, host, () => {
    console.log(
      `Plotline started at http://${displayHostForLog(host)}:${port} [${isProd ? 'production' : 'development'}]`
    )
  })

  registerProcessHandlers(httpServer, { vite, yjsWss, trpcWs, sockets })
}

startServer()
