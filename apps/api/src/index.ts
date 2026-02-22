import express from 'express'
import path from 'path'
import fs from 'fs'
import { type Express } from 'express'
import { createServer as createHttpServer, type Server as HttpServer } from 'http'
import { type Socket } from 'net'
import { createServer as createViteServer, type ViteDevServer } from 'vite'
import { createExpressMiddleware } from '@trpc/server/adapters/express'
import cookieParser from 'cookie-parser'
import { z } from 'zod/v4'
import { type WebSocketServer } from 'ws'
import { appRouter } from './trpc/router.js'
import { PROJECT_ROOT } from './paths.js'
import { generate, generateStream, createStreamCleaner, cleanText } from './ai/index.js'
import {
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_STRUCTURED,
  buildContinuePrompt,
  buildPromptPrompt,
} from './ai/prompts.js'
import { ResponseParser, type AIMode } from './ai/response-parser.js'
import { setupYjsWebSocket } from './yjs/websocket-handler.js'
import {
  flushAllDocumentStates,
  startSnapshotTimer,
  stopPersistenceFlushLoop,
  stopSnapshotTimer,
} from './yjs/server.js'

const isProd = process.env.NODE_ENV === 'production'
const DEFAULT_PORT = 5677
const DEFAULT_HOST = '127.0.0.1'

function resolvePort(rawPort: string | undefined): number {
  const parsed = Number.parseInt(rawPort ?? '', 10)
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535) {
    return parsed
  }
  return DEFAULT_PORT
}

function resolveHost(rawHost: string | undefined): string {
  const trimmed = rawHost?.trim()
  return trimmed ? trimmed : DEFAULT_HOST
}

function displayHostForLog(bindHost: string): string {
  if (bindHost === '0.0.0.0' || bindHost === '::') return 'localhost'
  return bindHost.includes(':') ? `[${bindHost}]` : bindHost
}

const port = resolvePort(process.env.PORT)
const host = resolveHost(process.env.HOST)
const WEB_ROOT = path.join(PROJECT_ROOT, 'apps/web')

const MAX_CONTEXT_CHARS = 1_000_000
const MAX_HINT_CHARS = 10_000
const MAX_PROMPT_CHARS = 50_000

const aiStreamInputSchema = z
  .object({
    mode: z.enum(['continue', 'prompt']),
    contextBefore: z.string().min(1).max(MAX_CONTEXT_CHARS),
    contextAfter: z.string().max(MAX_CONTEXT_CHARS).optional(),
    hint: z.string().trim().max(MAX_HINT_CHARS).optional(),
    prompt: z.string().trim().max(MAX_PROMPT_CHARS).optional(),
    selectedText: z.string().max(MAX_CONTEXT_CHARS).optional(),
    maxOutputTokens: z.number().int().min(64).max(4096).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'prompt' && !value.prompt?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['prompt'],
        message: 'Prompt is required when mode is "prompt".',
      })
    }
    const totalContext = value.contextBefore.length + (value.contextAfter?.length ?? 0)
    if (totalContext > MAX_CONTEXT_CHARS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contextBefore'],
        message: `Combined contextBefore and contextAfter length exceeds ${MAX_CONTEXT_CHARS} characters.`,
      })
    }
  })

function registerMetaRoutes(app: Express): void {
  app.get('/.well-known/{*path}', (_req, res) => {
    res.status(204).end()
  })
}

function registerAiStreamRoute(app: Express): void {
  app.post('/api/ai/stream', async (req, res) => {
    const parsed = aiStreamInputSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ message: 'Invalid AI stream payload', issues: parsed.error.issues })
      return
    }

    const input = parsed.data
    const contextAfter = input.contextAfter ?? null
    const selectedText = input.selectedText ?? null

    if (input.mode === 'continue') {
      await handleContinueStream(
        req,
        res,
        input as typeof input & { mode: 'continue' },
        contextAfter
      )
    } else {
      await handlePromptStream(
        req,
        res,
        input as typeof input & { mode: 'prompt' },
        contextAfter,
        selectedText
      )
    }
  })
}

async function handleGenericStream(
  req: express.Request,
  res: express.Response,
  options: {
    systemPrompt: string
    userPrompt: string
    maxOutputTokens?: number
    onDelta: (
      text: string,
      hasWrittenHeaders: boolean,
      writeHeaders: (mode?: AIMode, insertIndex?: number) => void,
      writeContent: (content: string) => void,
      writeChoice: (choice: string) => void
    ) => void
    generateFallback: (signal: AbortSignal) => Promise<string | null>
    onFallbackDone: (
      fallbackText: string,
      writeHeaders: (mode?: AIMode, insertIndex?: number) => void,
      writeContent: (content: string) => void,
      writeChoice: (choice: string) => void
    ) => boolean
    onFlush?: () => string | null
  }
) {
  const abortController = new AbortController()
  const abortIfClientDisconnected = () => {
    if (!res.writableEnded) abortController.abort()
  }
  req.on('aborted', abortIfClientDisconnected)
  res.on('close', abortIfClientDisconnected)

  let hasWrittenHeaders = false

  const writeHeaders = (mode?: AIMode, insertIndex?: number) => {
    if (!hasWrittenHeaders) {
      res.status(200).set({
        'Content-Type': mode ? 'application/jsonl; charset=utf-8' : 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...(mode ? { 'X-AI-Mode': mode } : {}),
      })
      if (insertIndex !== undefined) res.set('X-AI-Insert-Index', String(insertIndex))
      hasWrittenHeaders = true
    }
  }

  const writeContent = (content: string) => {
    // If we wrote headers with X-AI-Mode, we output JSON stringified lines
    // Otherwise just output the raw text for plain stream (continue)
    if (hasWrittenHeaders && res.getHeader('X-AI-Mode')) {
      res.write(JSON.stringify(content) + '\n')
    } else {
      res.write(content)
    }
  }

  const writeChoice = (choice: string) => {
    res.write(JSON.stringify(choice) + '\n')
  }

  try {
    const result = await generateStream({
      systemPrompt: options.systemPrompt,
      userPrompt: options.userPrompt,
      maxOutputTokens: options.maxOutputTokens ?? 512,
      temperature: 0.85,
      abortSignal: abortController.signal,
    })

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        options.onDelta(part.text, hasWrittenHeaders, writeHeaders, writeContent, writeChoice)
        continue
      }

      if (part.type === 'error') {
        const errMessage =
          part.error instanceof Error ? part.error.message : 'AI provider returned an error'
        if (!hasWrittenHeaders) {
          const fallbackText = await options.generateFallback(abortController.signal)
          if (
            fallbackText &&
            options.onFallbackDone(fallbackText, writeHeaders, writeContent, writeChoice)
          ) {
            res.end()
            return
          }
          res.status(500).json({ message: errMessage })
          return
        }
        res.end()
        return
      }
    }

    if (!hasWrittenHeaders) {
      const fallbackText = await options.generateFallback(abortController.signal)
      if (
        fallbackText &&
        options.onFallbackDone(fallbackText, writeHeaders, writeContent, writeChoice)
      ) {
        res.end()
        return
      }
      res.status(502).json({ message: 'AI stream finished without output' })
      return
    }

    const finalFlush = options.onFlush?.()
    if (finalFlush) writeContent(finalFlush)
    res.end()
  } catch (error: unknown) {
    if (abortController.signal.aborted) {
      if (!res.headersSent) res.end()
      return
    }
    const message = error instanceof Error ? error.message : 'Failed to generate text stream'
    if (!res.headersSent) res.status(500).json({ message })
    else res.end()
  }
}

async function handleContinueStream(
  req: express.Request,
  res: express.Response,
  input: z.infer<typeof aiStreamInputSchema> & { mode: 'continue' },
  contextAfter: string | null
): Promise<void> {
  const userPrompt = buildContinuePrompt(input.contextBefore, contextAfter, input.hint)
  const cleaner = createStreamCleaner(input.contextBefore, contextAfter)

  await handleGenericStream(req, res, {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxOutputTokens: input.maxOutputTokens,
    onDelta: (text, _hasWrittenHeaders, writeHeaders, writeContent) => {
      writeHeaders()
      const cleaned = cleaner.process(text)
      if (cleaned) writeContent(cleaned)
    },
    generateFallback: async (signal) => {
      const fallback = await generate({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        maxOutputTokens: input.maxOutputTokens ?? 512,
        temperature: 0.85,
        abortSignal: signal,
      })
      return fallback ? cleanText(fallback, input.contextBefore, contextAfter) : null
    },
    onFallbackDone: (fallbackText, writeHeaders, writeContent) => {
      writeHeaders()
      writeContent(fallbackText)
      return true
    },
    onFlush: () => cleaner.flush(),
  })
}

async function handlePromptStream(
  req: express.Request,
  res: express.Response,
  input: z.infer<typeof aiStreamInputSchema> & { mode: 'prompt' },
  contextAfter: string | null,
  selectedText: string | null
): Promise<void> {
  const userPrompt = buildPromptPrompt(
    input.contextBefore,
    contextAfter,
    input.prompt!.trim(),
    selectedText
  )

  const cleaner = createStreamCleaner(input.contextBefore, contextAfter)
  const parser = new ResponseParser()
  let lastSentContentLength = 0
  let lastSentChoicesCount = 0

  await handleGenericStream(req, res, {
    systemPrompt: SYSTEM_PROMPT_STRUCTURED,
    userPrompt,
    maxOutputTokens: input.maxOutputTokens,
    onDelta: (text, hasWrittenHeaders, writeHeaders, writeContent, writeChoice) => {
      const parseResult = parser.feed(text)
      if (parseResult.mode && !hasWrittenHeaders)
        writeHeaders(parseResult.mode, parseResult.insertIndex ?? undefined)
      if (parseResult.mode === 'replace' || parseResult.mode === 'insert') {
        const newContent = parseResult.content.slice(lastSentContentLength)
        if (newContent) {
          const cleaned = cleaner.process(newContent)
          if (cleaned) writeContent(cleaned)
          lastSentContentLength = parseResult.content.length
        }
      } else if (parseResult.mode === 'choices') {
        for (let i = lastSentChoicesCount; i < parseResult.choices.length; i++)
          writeChoice(parseResult.choices[i])
        lastSentChoicesCount = parseResult.choices.length
      }
    },
    generateFallback: async (signal) => {
      return await generate({
        systemPrompt: SYSTEM_PROMPT_STRUCTURED,
        userPrompt,
        maxOutputTokens: input.maxOutputTokens ?? 512,
        temperature: 0.85,
        abortSignal: signal,
      })
    },
    onFallbackDone: (fallbackText, writeHeaders, writeContent, writeChoice) => {
      const fallbackParser = new ResponseParser()
      fallbackParser.feed(fallbackText)
      const fallbackResponse = fallbackParser.finalize()
      if (fallbackResponse) {
        const insertIndex = fallbackResponse.mode === 'insert' ? fallbackResponse.index : undefined
        writeHeaders(fallbackResponse.mode, insertIndex)
        if (fallbackResponse.mode === 'replace' || fallbackResponse.mode === 'insert') {
          const cleaned = cleanText(fallbackResponse.content, input.contextBefore, contextAfter)
          if (cleaned) writeContent(cleaned)
        } else if (fallbackResponse.mode === 'choices') {
          for (const choice of fallbackResponse.choices) writeChoice(choice)
        }
        return true
      }
      return false
    },
    onFlush: () => cleaner.flush(),
  })
}

function registerTrpcRoutes(app: Express): void {
  app.use('/api/trpc', createExpressMiddleware({ router: appRouter }))
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
      server: { middlewareMode: true },
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
    stopSnapshotTimer()
    stopPersistenceFlushLoop()

    const forceShutdownTimer = setTimeout(() => {
      console.error('Graceful shutdown timed out, forcing exit.')
      forceExit(1)
    }, 5000)
    if (typeof forceShutdownTimer.unref === 'function') {
      forceShutdownTimer.unref()
    }

    void flushAllDocumentStates()
      .catch((error) => {
        console.error('Failed to flush Yjs documents on shutdown:', error)
      })
      .then(async () => {
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
  registerAiStreamRoute(app)
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

  const yjsWss = setupYjsWebSocket(httpServer)
  startSnapshotTimer()

  httpServer.listen(port, host, () => {
    console.log(
      `Plotline started at http://${displayHostForLog(host)}:${port} [${isProd ? 'production' : 'development'}]`
    )
  })

  registerProcessHandlers(httpServer, { vite, yjsWss, sockets })
}

startServer()
