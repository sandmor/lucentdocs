import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface YjsProviderResult {
  doc: Y.Doc
  provider: WebsocketProvider
  type: Y.XmlFragment
  isConnected: () => boolean
  isSynced: () => boolean
  disconnect: () => void
}

export function createYjsProvider(
  documentId: string,
  onConnectionChange?: (status: ConnectionStatus) => void,
  onSync?: () => void
): YjsProviderResult {
  const doc = new Y.Doc()
  const type = doc.getXmlFragment('prosemirror')

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${protocol}//${window.location.host}/api/yjs`

  onConnectionChange?.('connecting')

  const provider = new WebsocketProvider(wsUrl, documentId, doc, {
    connect: true,
  })

  provider.on('status', (event: { status: string }) => {
    if (event.status === 'connected') {
      onConnectionChange?.('connected')
    } else if (event.status === 'disconnected') {
      onConnectionChange?.('disconnected')
    } else if (event.status === 'connecting') {
      onConnectionChange?.('connecting')
    }
  })

  provider.on('sync', (synced: boolean) => {
    if (synced) {
      onSync?.()
    }
  })

  const disconnect = () => {
    provider.disconnect()
    provider.destroy()
    doc.destroy()
  }

  return {
    doc,
    provider,
    type,
    isConnected: () => provider.wsconnected,
    isSynced: () => provider.synced,
    disconnect,
  }
}
