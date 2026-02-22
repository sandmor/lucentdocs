import { WebSocketServer } from 'ws'
import { Server as HttpServer } from 'http'
import { isValidId } from '@plotline/shared'
import * as dalDocuments from '../db/dal/documents.js'
import { ensureDocumentLoaded, setupWSConnection } from './server.js'

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

export function setupYjsWebSocket(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/api/yjs/')) return

    const documentId = extractDocumentIdFromYjsUrl(req.url, req.headers.host ?? 'localhost')
    if (!documentId) {
      socket.destroy()
      return
    }

    void dalDocuments
      .findById(documentId)
      .then((existingDoc) => {
        if (!existingDoc) {
          socket.destroy()
          return
        }

        return ensureDocumentLoaded(documentId).then(() => {
          wss.handleUpgrade(req, socket, head, (ws) => {
            setupWSConnection(ws, req, { docName: documentId })
          })
        })
      })
      .then(() => {
        return
      })
      .catch((error) => {
        console.error(`Failed to initialize Yjs doc ${documentId}:`, error)
        socket.destroy()
      })
  })

  return wss
}
