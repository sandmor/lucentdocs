import express from 'express'
import path from 'path'
import fs from 'fs'
import { type Express } from 'express'
import { createServer, type ViteDevServer } from 'vite'
import { createExpressMiddleware } from '@trpc/server/adapters/express'
import cookieParser from 'cookie-parser'
import { z } from 'zod/v4'
import { appRouter } from './trpc/router.js'
import { PROJECT_ROOT } from './paths.js'
import { generate, generateStream, createStreamCleaner, cleanText } from './ai/index.js'
import { SYSTEM_PROMPT, buildContinuePrompt, buildPromptPrompt } from './ai/prompts.js'

const isProd = process.env.NODE_ENV === 'production'
const port = process.env.PORT || 5677
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
    const userPrompt =
      input.mode === 'continue'
        ? buildContinuePrompt(input.contextBefore, contextAfter, input.hint)
        : buildPromptPrompt(input.contextBefore, contextAfter, input.prompt!.trim())

    const cleaner = createStreamCleaner(input.contextBefore, contextAfter)
    const generateCleanFallback = async (): Promise<string | null> => {
      const fallbackText = await generate({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        maxOutputTokens: input.maxOutputTokens ?? 512,
        temperature: 0.85,
        abortSignal: abortController.signal,
      })

      if (!fallbackText) {
        return null
      }

      return cleanText(fallbackText, input.contextBefore, contextAfter)
    }

    const abortController = new AbortController()
    const abortIfClientDisconnected = () => {
      if (!res.writableEnded) {
        abortController.abort()
      }
    }

    req.on('aborted', abortIfClientDisconnected)
    res.on('close', abortIfClientDisconnected)

    try {
      const result = await generateStream({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        maxOutputTokens: input.maxOutputTokens ?? 512,
        temperature: 0.85,
        abortSignal: abortController.signal,
      })

      let hasWritten = false
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          if (!hasWritten) {
            res.status(200).set({
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            })
          }
          const cleaned = cleaner.process(part.text)
          if (cleaned) {
            hasWritten = true
            res.write(cleaned)
          }
          continue
        }

        if (part.type === 'error') {
          const streamErrorMessage =
            part.error instanceof Error ? part.error.message : 'AI provider returned an error'

          if (!hasWritten) {
            const cleanedFallback = await generateCleanFallback()

            if (cleanedFallback) {
              res
                .status(200)
                .set({ 'Content-Type': 'text/plain; charset=utf-8' })
                .end(cleanedFallback)
              return
            }

            res.status(500).json({ message: streamErrorMessage })
            return
          }

          res.end()
          return
        }
      }

      if (!hasWritten) {
        const cleanedFallback = await generateCleanFallback()

        if (cleanedFallback) {
          res.status(200).set({ 'Content-Type': 'text/plain; charset=utf-8' }).end(cleanedFallback)
          return
        }

        res.status(502).json({ message: 'AI stream finished without output' })
        return
      }

      const final = cleaner.flush()
      if (final) {
        res.write(final)
      }
      res.end()
    } catch (error: unknown) {
      if (abortController.signal.aborted) {
        if (!res.headersSent) res.end()
        return
      }

      const message = error instanceof Error ? error.message : 'Failed to generate text stream'
      if (!res.headersSent) {
        res.status(500).json({ message })
      } else {
        res.end()
      }
    }
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
    const vite = await createServer({
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

function registerProcessHandlers(server: ReturnType<Express['listen']>): void {
  process.on('SIGINT', () => {
    console.log('Shutting down...')
    server.close(() => process.exit(0))
  })
}

async function startServer() {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())

  registerMetaRoutes(app)
  registerAiStreamRoute(app)
  registerTrpcRoutes(app)

  const vite = await setupWebRuntime(app)
  registerSsrRoute(app, vite)

  const server = app.listen(port, () => {
    console.log(
      `Plotline started at http://localhost:${port} [${isProd ? 'production' : 'development'}]`
    )
  })

  registerProcessHandlers(server)
}

startServer()
