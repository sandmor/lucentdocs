import { WebSocketServer } from 'ws'
import { Server as HttpServer } from 'http'
import { isValidId } from '@lucentdocs/shared'
import type { YjsRuntime } from './runtime.js'
import { setupWSConnection } from './runtime.js'
import { readSessionTokenFromCookieHeader } from '../http/auth.js'
import type { AuthPort } from '../core/ports/auth.port.js'
import type { ProjectDocumentsRepositoryPort } from '../core/ports/projectDocuments.port.js'
import type { ProjectsRepositoryPort } from '../core/ports/projects.port.js'
import { canUserAccessProject } from '../core/models/project-access.js'
import { projectSyncBus } from '../app/project-sync.js'

export function extractDocumentIdFromYjsUrl(urlValue: string, host: string): string | null {
  try {
    const url = new URL(urlValue, `http://${host}`)
    const pathParts = url.pathname.split('/').filter(Boolean)
    if (pathParts.length !== 3 || pathParts[0] !== 'api' || pathParts[1] !== 'yjs') {
      return null
    }

    const documentId = pathParts[2]

    if (!documentId || !isValidId(documentId)) {
      return null
    }

    return documentId
  } catch {
    return null
  }
}

export function setupYjsWebSocket(
  server: HttpServer,
  runtime: YjsRuntime,
  options: {
    authPort: AuthPort
    projects: ProjectsRepositoryPort
    projectDocuments: ProjectDocumentsRepositoryPort
  }
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/api/yjs/')) return

    const documentId = extractDocumentIdFromYjsUrl(req.url, req.headers.host ?? 'localhost')
    if (!documentId) {
      socket.destroy()
      return
    }

    void (async () => {
      try {
        const token = readSessionTokenFromCookieHeader(req.headers.cookie)
        const user = options.authPort.isEnabled()
          ? token
            ? await options.authPort.validateSession(token)
            : null
          : await options.authPort.validateSession('')
        if (!user) {
          socket.destroy()
          return
        }

        const repos = runtime.getRepos()
        const yjsData = await repos.yjsDocuments.getPersisted(documentId)

        if (!yjsData) {
          socket.destroy()
          return
        }

        const projectId = await options.projectDocuments.findSoleProjectIdByDocumentId(documentId)
        if (!projectId) {
          socket.destroy()
          return
        }

        const project = await options.projects.findById(projectId)
        if (!project || !canUserAccessProject(user, project)) {
          socket.destroy()
          return
        }

        await runtime.ensureDocumentLoaded(documentId)
        wss.handleUpgrade(req, socket, head, (ws) => {
          setupWSConnection(ws, req, { docName: documentId })

          const unsubscribe = projectSyncBus.subscribe((event) => {
            if (event.projectId !== projectId) return
            if (event.type !== 'project.updated' && event.type !== 'project.deleted') return

            if (event.type === 'project.updated' && canUserAccessProject(user, event)) {
              return
            }

            ws.close()
          })

          ws.once('close', unsubscribe)
        })
      } catch (error) {
        console.error(`Failed to initialize Yjs doc ${documentId}:`, error)
        socket.destroy()
      }
    })()
  })

  return wss
}
