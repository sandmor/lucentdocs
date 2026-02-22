export type DocumentItem = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export type BrowserRow =
  | {
      key: string
      type: 'directory'
      name: string
      path: string
      createdAt: number
      updatedAt: number
    }
  | {
      key: string
      type: 'document'
      id: string
      name: string
      path: string
      createdAt: number
      updatedAt: number
    }

export type RenameTarget =
  | {
      type: 'document'
      document: DocumentItem
    }
  | {
      type: 'directory'
      path: string
    }

export type MoveTarget =
  | {
      type: 'document'
      document: DocumentItem
    }
  | {
      type: 'directory'
      path: string
    }

export type DeleteTarget =
  | {
      type: 'document'
      document: DocumentItem
    }
  | {
      type: 'directory'
      path: string
    }

export type DragData =
  | {
      kind: 'document'
      id: string
      path: string
    }
  | {
      kind: 'directory'
      path: string
    }

export type DropData =
  | {
      kind: 'root'
    }
  | {
      kind: 'directory'
      path: string
    }

export interface DocumentBrowserProps {
  projectId: string
  documents: DocumentItem[]
  isLoading: boolean
  activeDocumentId: string
  onOpenDocument: (documentId: string) => void
}
