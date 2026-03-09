export type DocumentItem = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export type DocumentSearchResultItem = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  score: number
  matchType: 'snippet' | 'whole_document'
  snippets: Array<{
    text: string
    score: number
    start: number
    end: number
  }>
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
      type: 'search-result'
      id: string
      name: string
      path: string
      createdAt: number
      updatedAt: number
      score: number
      matchType: 'snippet' | 'whole_document'
      snippets: Array<{
        text: string
        score: number
        start: number
        end: number
      }>
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
  onOpenDocument: (documentId: string, range?: { start: number; end: number }) => void
}
