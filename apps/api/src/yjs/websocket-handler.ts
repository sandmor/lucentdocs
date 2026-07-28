import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import { Server as HttpServer } from 'http'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { isValidId } from '@lucentdocs/shared'
import type { YjsRuntime } from './runtime.js'
import { getYDoc, setupWSConnection } from './runtime.js'
import { readSessionTokenFromCookieHeader } from '../http/auth.js'
import type { AuthPort } from '../core/ports/auth.port.js'
import type { ProjectDocumentsRepositoryPort } from '../core/ports/projectDocuments.port.js'
import type { ProjectsRepositoryPort } from '../core/ports/projects.port.js'
import type { DocumentsRepositoryPort } from '../core/ports/documents.port.js'
import type { DocumentCollaboratorsRepositoryPort } from '../core/ports/documentCollaborators.port.js'
import { canUserAccessProject } from '../core/models/project-access.js'
import { projectSyncBus } from '../app/project-sync.js'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const SYNC_STEP1 = 0

/**
 * y-websocket has no authorization hook. This narrow adapter keeps the normal
 * protocol but refuses client update frames for viewers; they may still send a
 * sync step-1 (needed to receive state) and awareness updates.
 */
function setupRoleAwareConnection(ws: WebSocket, documentId: string, role: 'owner' | 'editor' | 'viewer') {
  if (role !== 'viewer') {
    setupWSConnection(ws, { url: `/api/yjs/${documentId}` } as never, { docName: documentId })
    return
  }
  const doc = getYDoc(documentId) as any
  ws.binaryType = 'arraybuffer'
  doc.conns.set(ws, new Set())
  const send = (message: Uint8Array) => {
    if (ws.readyState === ws.OPEN) ws.send(message)
  }
  const sendInitial = () => {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(encoder, doc)
    send(encoding.toUint8Array(encoder))
    const states = doc.awareness.getStates()
    if (states.size) {
      const awareness = encoding.createEncoder()
      encoding.writeVarUint(awareness, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(awareness, awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(states.keys())))
      send(encoding.toUint8Array(awareness))
    }
  }
  ws.on('message', (raw: ArrayBuffer) => {
    const data = new Uint8Array(raw)
    const probe = decoding.createDecoder(data)
    const outerType = decoding.readVarUint(probe)
    if (outerType === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(probe), ws)
      return
    }
    if (outerType !== MESSAGE_SYNC || decoding.readVarUint(probe) !== SYNC_STEP1) return
    const decoder = decoding.createDecoder(data)
    decoding.readVarUint(decoder)
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.readSyncMessage(decoder, encoder, doc, ws)
    if (encoding.length(encoder) > 1) send(encoding.toUint8Array(encoder))
  })
  ws.on('close', () => {
    const ids = Array.from((doc.conns.get(ws) ?? new Set()) as Set<number>)
    doc.conns.delete(ws)
    awarenessProtocol.removeAwarenessStates(doc.awareness, ids, null)
  })
  sendInitial()
}

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
    documents: DocumentsRepositoryPort
    documentCollaborators: DocumentCollaboratorsRepositoryPort
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
        // Canonical existence is the persisted ProseMirror content, not the Yjs blob.
        // The blob is a regenerable cache that is deleted on restore; relying on it here
        // would reject every reconnection after a restore (regenerated only on load).
        const [yjsData, contentRow] = await Promise.all([
          repos.yjsDocuments.getPersisted(documentId),
          repos.documentContent.findByDocumentId(documentId),
        ])

        if (!yjsData && !contentRow) {
          socket.destroy()
          return
        }

        const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
        const projectId = url.searchParams.get('projectId')
        if (!projectId || !isValidId(projectId)) {
          socket.destroy()
          return
        }

        const [project, document, isMounted] = await Promise.all([
          options.projects.findById(projectId),
          options.documents.findById(documentId),
          options.projectDocuments.hasProjectDocument(projectId, documentId),
        ])
        const homeProject = document ? await options.projects.findById(document.homeProjectId) : null
        const documentRole = document
          ? homeProject?.ownerUserId === user.id
            ? 'owner'
            : (await options.documentCollaborators.find(documentId, user.id))?.role
          : null
        if (!project || !isMounted || !canUserAccessProject(user, project) || !documentRole) {
          socket.destroy()
          return
        }

        await runtime.ensureDocumentLoaded(documentId)
        wss.handleUpgrade(req, socket, head, (ws) => {
          setupRoleAwareConnection(ws, documentId, documentRole)

          const unsubscribe = projectSyncBus.subscribe((event) => {
            if (event.projectId !== projectId) return
            if (event.type === 'document.access-changed' && event.documentId === documentId) {
              ws.close()
              return
            }
            if (event.type !== 'project.updated' && event.type !== 'project.deleted') return

            if (event.type === 'project.updated' && event.audienceUserIds.includes(user.id)) {
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
