import {
  useRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { isDirectorySentinelPath, normalizeDocumentPath, pathSegments } from '@plotline/shared'
import { trpc } from '@/lib/trpc'
import { Editor, type EditorHandle } from '@/components/editor'
import { VersionHistory, type VersionSnapshotInfo } from '@/components/version-history'
import { DocumentBrowser } from '@/components/documents/document-browser'
import { ChatPanel } from '@/components/editor/chat-panel'
import { SidebarIconBar, type SidebarPanel } from '@/components/editor/sidebar-icon-bar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { ArrowLeft, Loader2, Wifi, WifiOff, PanelLeftClose, PanelLeft, Menu, X } from 'lucide-react'
import type { ConnectionStatus } from '@/lib/yjs-provider'
import { parseProjectSyncEvent } from '@/lib/project-sync-events'
import type { PanelImperativeHandle } from 'react-resizable-panels'
import { cn } from '@/lib/utils'

const DESKTOP_SIDEBAR_STORAGE_KEY_PREFIX = 'plotline:editor:desktop-sidebar:'
const DESKTOP_SIDEBAR_DEFAULT_WIDTH_PERCENTAGE = 25
const DESKTOP_SIDEBAR_MIN_WIDTH_PERCENTAGE = 10
const DESKTOP_SIDEBAR_MAX_WIDTH_PERCENTAGE = 40
const DESKTOP_SIDEBAR_OPEN_THRESHOLD_PERCENTAGE = 1
const DESKTOP_SIDEBAR_PANEL_ID = 'desktop-sidebar'

interface PersistedDesktopSidebarState {
  isOpen: boolean
  widthPercentage: number
}

function getDesktopSidebarStorageKey(projectId: string): string {
  return `${DESKTOP_SIDEBAR_STORAGE_KEY_PREFIX}${projectId}`
}

function clampDesktopSidebarWidth(widthPercentage: number): number {
  return Math.min(
    DESKTOP_SIDEBAR_MAX_WIDTH_PERCENTAGE,
    Math.max(DESKTOP_SIDEBAR_MIN_WIDTH_PERCENTAGE, widthPercentage)
  )
}

function getDefaultDesktopSidebarOpen(): boolean {
  if (typeof window === 'undefined') return true
  return window.innerWidth >= 1024
}

function readPersistedDesktopSidebarState(
  projectId: string | undefined
): PersistedDesktopSidebarState | null {
  if (!projectId || typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(getDesktopSidebarStorageKey(projectId))
    if (!raw) return null

    const parsed = JSON.parse(raw) as { isOpen?: unknown; widthPercentage?: unknown }
    if (typeof parsed.isOpen !== 'boolean') return null
    if (typeof parsed.widthPercentage !== 'number' || !Number.isFinite(parsed.widthPercentage)) {
      return null
    }

    return {
      isOpen: parsed.isOpen,
      widthPercentage: clampDesktopSidebarWidth(parsed.widthPercentage),
    }
  } catch {
    return null
  }
}

function writePersistedDesktopSidebarState(
  projectId: string,
  state: PersistedDesktopSidebarState
): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(
      getDesktopSidebarStorageKey(projectId),
      JSON.stringify({
        isOpen: state.isOpen,
        widthPercentage: clampDesktopSidebarWidth(state.widthPercentage),
      })
    )
  } catch {
    // Ignore storage write errors (e.g. quota or privacy mode restrictions).
  }
}

function resolveDesktopSidebarState(projectId: string | undefined): PersistedDesktopSidebarState {
  const persistedState = readPersistedDesktopSidebarState(projectId)
  if (persistedState) return persistedState

  return {
    isOpen: getDefaultDesktopSidebarOpen(),
    widthPercentage: DESKTOP_SIDEBAR_DEFAULT_WIDTH_PERCENTAGE,
  }
}

export function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const editorRef = useRef<EditorHandle>(null)
  const lastSavedPathRef = useRef<string | null>(null)
  const activeDocumentIdRef = useRef<string | null>(null)
  const autoOpenAttemptedProjectRef = useRef<string | null>(null)
  const persistedDefaultSignatureRef = useRef<string | null>(null)
  const lastHandledSyncEventIdRef = useRef<string | null>(null)
  const initialDesktopSidebarState = useMemo(() => resolveDesktopSidebarState(id), [id])

  const [includeAfterContext, setIncludeAfterContext] = useState(true)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')
  const [titleInput, setTitleInput] = useState('')
  const [editorSessionKey, setEditorSessionKey] = useState(0)
  const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel>('explorer')
  const [desktopSidebarStateByProject, setDesktopSidebarStateByProject] = useState<
    Record<string, PersistedDesktopSidebarState>
  >(() => (id ? { [id]: initialDesktopSidebarState } : {}))
  const currentDesktopSidebarState = useMemo<PersistedDesktopSidebarState>(
    () =>
      id
        ? (desktopSidebarStateByProject[id] ?? initialDesktopSidebarState)
        : initialDesktopSidebarState,
    [desktopSidebarStateByProject, id, initialDesktopSidebarState]
  )
  const isSidebarOpen = currentDesktopSidebarState.isOpen
  const desktopSidebarWidthPercentage = currentDesktopSidebarState.widthPercentage
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.matchMedia('(min-width: 768px)').matches
  })
  const [editorSelectionForChat, setEditorSelectionForChat] = useState<{
    from: number
    to: number
  } | null>(null)
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null)

  const updateCurrentSidebarState = useCallback(
    (updater: (previous: PersistedDesktopSidebarState) => PersistedDesktopSidebarState) => {
      if (!id) return

      setDesktopSidebarStateByProject((previous) => {
        const current = previous[id] ?? resolveDesktopSidebarState(id)
        const updated = updater(current)
        const next: PersistedDesktopSidebarState = {
          isOpen: updated.isOpen,
          widthPercentage: clampDesktopSidebarWidth(updated.widthPercentage),
        }

        if (
          next.isOpen === current.isOpen &&
          Math.abs(next.widthPercentage - current.widthPercentage) < 0.1
        ) {
          return previous
        }

        return {
          ...previous,
          [id]: next,
        }
      })
    },
    [id]
  )

  const setIsSidebarOpen = useCallback(
    (next: boolean | ((previous: boolean) => boolean)) => {
      updateCurrentSidebarState((previous) => ({
        ...previous,
        isOpen: typeof next === 'function' ? next(previous.isOpen) : next,
      }))
    },
    [updateCurrentSidebarState]
  )

  const setDesktopSidebarWidthPercentage = useCallback(
    (next: number | ((previous: number) => number)) => {
      updateCurrentSidebarState((previous) => ({
        ...previous,
        widthPercentage: typeof next === 'function' ? next(previous.widthPercentage) : next,
      }))
    },
    [updateCurrentSidebarState]
  )

  const projectQuery = trpc.projects.get.useQuery(
    { id: id! },
    {
      enabled: !!id,
      retry: (failureCount) => failureCount < 8,
      retryDelay: (attempt) => Math.min(200 * 2 ** Math.max(0, attempt - 1), 1200),
      refetchOnWindowFocus: false,
    }
  )
  const documentsQuery = trpc.documents.list.useQuery({ projectId: id! }, { enabled: !!id })
  const visibleDocuments = useMemo(
    () =>
      (documentsQuery.data ?? []).filter(
        (doc) => !isDirectorySentinelPath(normalizeDocumentPath(doc.title))
      ),
    [documentsQuery.data]
  )

  const defaultDocumentIdFromProject = useMemo(() => {
    const value = projectQuery.data?.metadata?.['default_document']
    return typeof value === 'string' ? value : null
  }, [projectQuery.data?.metadata])

  const fallbackDocumentId = useMemo(() => {
    if (visibleDocuments.length === 0) return null
    return visibleDocuments[0]!.id
  }, [visibleDocuments])

  const currentDocumentId = useMemo(() => {
    if (!fallbackDocumentId) return null

    const requestedDocumentId = searchParams.get('document')
    if (requestedDocumentId && visibleDocuments.some((doc) => doc.id === requestedDocumentId)) {
      return requestedDocumentId
    }

    if (
      defaultDocumentIdFromProject &&
      visibleDocuments.some((doc) => doc.id === defaultDocumentIdFromProject)
    ) {
      return defaultDocumentIdFromProject
    }

    return fallbackDocumentId
  }, [defaultDocumentIdFromProject, fallbackDocumentId, searchParams, visibleDocuments])

  const documentQuery = trpc.documents.get.useQuery(
    {
      projectId: id!,
      id: currentDocumentId!,
    },
    {
      enabled: !!id && !!currentDocumentId,
    }
  )
  const versionsQuery = trpc.documents.versions.useQuery(
    {
      projectId: id!,
      id: currentDocumentId!,
    },
    {
      enabled: !!id && !!currentDocumentId,
    }
  )

  const updateMutation = trpc.documents.update.useMutation()
  const restoreMutation = trpc.documents.restore.useMutation()
  const createSnapshotMutation = trpc.documents.createSnapshot.useMutation()
  const openOrCreateDefaultDocumentMutation = trpc.documents.openOrCreateDefault.useMutation()
  const setDefaultDocumentMutation = trpc.documents.setDefault.useMutation()
  const utils = trpc.useUtils()

  useEffect(() => {
    if (!id || !projectQuery.data || documentsQuery.isLoading) return
    if (visibleDocuments.length > 0) return
    if (openOrCreateDefaultDocumentMutation.isPending) return
    if (autoOpenAttemptedProjectRef.current === id) return

    autoOpenAttemptedProjectRef.current = id
    openOrCreateDefaultDocumentMutation.mutate(
      { projectId: id },
      {
        onSuccess: (document) => {
          const next = new URLSearchParams(searchParams)
          next.set('document', document.id)
          setSearchParams(next, { replace: true })

          utils.documents.get.setData({ projectId: id, id: document.id }, document)
          utils.documents.list.setData({ projectId: id }, (documents) => {
            const summary = {
              id: document.id,
              title: document.title,
              type: document.type,
              metadata: document.metadata,
              createdAt: document.createdAt,
              updatedAt: document.updatedAt,
            }
            if (!documents) return [summary]
            return [summary, ...documents.filter((item) => item.id !== summary.id)]
          })
        },
        onError: (error) => {
          toast.error('Failed to create a starter document', {
            description: error.message,
          })
        },
      }
    )
  }, [
    documentsQuery.isLoading,
    id,
    openOrCreateDefaultDocumentMutation,
    projectQuery.data,
    searchParams,
    setSearchParams,
    utils.documents.get,
    utils.documents.list,
    visibleDocuments.length,
  ])

  useEffect(() => {
    if (!id) return
    if (!currentDocumentId) return

    const signature = `${id}:${currentDocumentId}`
    if (persistedDefaultSignatureRef.current === signature) return
    persistedDefaultSignatureRef.current = signature

    setDefaultDocumentMutation.mutate(
      { projectId: id, id: currentDocumentId },
      {
        onSuccess: () => {
          utils.projects.get.setData({ id }, (current) => {
            if (!current) return current
            return {
              ...current,
              metadata: {
                ...(current.metadata ?? {}),
                default_document: currentDocumentId,
              },
            }
          })
        },
        onError: () => {
          persistedDefaultSignatureRef.current = null
        },
      }
    )
  }, [currentDocumentId, id, setDefaultDocumentMutation, utils.projects.get])

  const documentPath = useMemo(
    () => normalizeDocumentPath(documentQuery.data?.title ?? ''),
    [documentQuery.data?.title]
  )

  const documentBaseName = useMemo(() => {
    const parts = pathSegments(documentPath)
    return parts.at(-1) ?? ''
  }, [documentPath])

  useEffect(() => {
    if (activeDocumentIdRef.current === currentDocumentId) return

    activeDocumentIdRef.current = currentDocumentId
    lastSavedPathRef.current = null

    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setTitleInput('')
      setConnectionStatus('connecting')
    })

    return () => {
      cancelled = true
    }
  }, [currentDocumentId])

  useEffect(() => {
    if (!currentDocumentId || documentQuery.data?.id !== currentDocumentId) return
    if (!documentPath) return

    let nextTitle: string | null = null

    if (lastSavedPathRef.current === null) {
      lastSavedPathRef.current = documentPath
      nextTitle = documentBaseName
    } else {
      const lastSavedBaseName = (() => {
        const parts = pathSegments(lastSavedPathRef.current)
        return parts.at(-1) ?? ''
      })()

      if (documentPath !== lastSavedPathRef.current && titleInput === lastSavedBaseName) {
        lastSavedPathRef.current = documentPath
        nextTitle = documentBaseName
      }
    }

    if (nextTitle === null) return

    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setTitleInput(nextTitle)
    })

    return () => {
      cancelled = true
    }
  }, [currentDocumentId, documentBaseName, documentPath, documentQuery.data?.id, titleInput])

  const commitTitle = useCallback(() => {
    if (!id || !currentDocumentId || updateMutation.isPending) return

    const trimmedTitle = titleInput.trim()
    if (!trimmedTitle) {
      const parts = pathSegments(lastSavedPathRef.current ?? documentPath)
      setTitleInput(parts.at(-1) ?? '')
      return
    }
    if (trimmedTitle.includes('/')) {
      toast.error('Document name cannot include slashes')
      return
    }

    const currentPath = normalizeDocumentPath(lastSavedPathRef.current ?? documentPath)
    if (!currentPath) return
    const currentParent = pathSegments(currentPath).slice(0, -1).join('/')
    const nextPath = normalizeDocumentPath(
      currentParent ? `${currentParent}/${trimmedTitle}` : trimmedTitle
    )
    if (!nextPath) return

    if (nextPath === lastSavedPathRef.current) {
      if (trimmedTitle !== titleInput) {
        setTitleInput(trimmedTitle)
      }
      return
    }

    updateMutation.mutate(
      { projectId: id, id: currentDocumentId, title: nextPath },
      {
        onSuccess: (document) => {
          const normalizedPath = normalizeDocumentPath(document.title)
          const parts = pathSegments(normalizedPath)

          lastSavedPathRef.current = normalizedPath
          setTitleInput(parts.at(-1) ?? '')
          utils.documents.get.setData({ projectId: id, id: currentDocumentId }, document)
          utils.documents.list.setData({ projectId: id }, (documents) =>
            documents?.map((item) =>
              item.id === currentDocumentId
                ? { ...item, title: document.title, updatedAt: document.updatedAt }
                : item
            )
          )
        },
        onError: (error) => {
          const parts = pathSegments(lastSavedPathRef.current ?? documentPath)
          setTitleInput(parts.at(-1) ?? '')
          toast.error('Failed to update document title', {
            description: error.message,
          })
        },
      }
    )
  }, [currentDocumentId, documentPath, id, titleInput, updateMutation, utils])

  const handleTitleBlur = useCallback(() => {
    commitTitle()
  }, [commitTitle])

  const handleTitleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commitTitle()
        e.currentTarget.blur()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        const parts = pathSegments(lastSavedPathRef.current ?? documentPath)
        setTitleInput(parts.at(-1) ?? '')
        e.currentTarget.blur()
      }
    },
    [commitTitle, documentPath]
  )

  const handleRestore = useCallback(
    (snapshotId: string) => {
      if (!id || !currentDocumentId) return
      restoreMutation.mutate(
        { projectId: id, id: currentDocumentId, snapshotId },
        {
          onSuccess: () => {
            setEditorSessionKey((value) => value + 1)
            utils.documents.get.invalidate({ projectId: id, id: currentDocumentId })
            utils.documents.versions.invalidate({ projectId: id, id: currentDocumentId })
            utils.documents.list.invalidate({ projectId: id })
            toast.success('Restored to selected version')
          },
          onError: (error) => {
            toast.error('Failed to restore version', {
              description: error.message,
            })
          },
        }
      )
    },
    [currentDocumentId, id, restoreMutation, utils]
  )

  const handleCreateSnapshot = useCallback(() => {
    if (!id || !currentDocumentId) return
    createSnapshotMutation.mutate(
      { projectId: id, id: currentDocumentId },
      {
        onSuccess: () => {
          utils.documents.versions.invalidate({ projectId: id, id: currentDocumentId })
          toast.success('Snapshot created')
        },
        onError: (error) => {
          toast.error('Failed to create snapshot', {
            description: error.message,
          })
        },
      }
    )
  }, [createSnapshotMutation, currentDocumentId, id, utils])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const activeElement = document.activeElement as HTMLElement | null
        const isEditorFocused = Boolean(activeElement?.closest('.ProseMirror'))
        if (!isEditorFocused) return

        e.preventDefault()
        editorRef.current?.startAIContinuation(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(min-width: 768px)')
    const sync = () => {
      setIsDesktop(mediaQuery.matches)
    }

    sync()
    mediaQuery.addEventListener('change', sync)
    return () => mediaQuery.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!isDesktop) return
    if (!id) return

    writePersistedDesktopSidebarState(id, {
      isOpen: isSidebarOpen,
      widthPercentage: desktopSidebarWidthPercentage,
    })
  }, [desktopSidebarWidthPercentage, id, isDesktop, isSidebarOpen])

  useEffect(() => {
    if (!isDesktop) return
    if (!id) return

    const panel = sidebarPanelRef.current
    if (!panel) return

    const { asPercentage } = panel.getSize()
    if (isSidebarOpen) {
      const targetSize = clampDesktopSidebarWidth(desktopSidebarWidthPercentage)
      if (Math.abs(asPercentage - targetSize) > 0.5) {
        panel.resize(`${targetSize}%`)
      }
      return
    }

    if (asPercentage > DESKTOP_SIDEBAR_OPEN_THRESHOLD_PERCENTAGE) {
      panel.collapse()
    }
  }, [desktopSidebarWidthPercentage, id, isDesktop, isSidebarOpen])

  const handleConnectionChange = useCallback((status: ConnectionStatus) => {
    setConnectionStatus(status)
  }, [])

  const handleOpenDocument = useCallback(
    (documentId: string) => {
      const next = new URLSearchParams(searchParams)
      next.set('document', documentId)
      setSearchParams(next)
    },
    [searchParams, setSearchParams]
  )

  useEffect(() => {
    if (!currentDocumentId) return
    if (searchParams.get('document') === currentDocumentId) return

    const next = new URLSearchParams(searchParams)
    next.set('document', currentDocumentId)
    setSearchParams(next, { replace: true })
  }, [currentDocumentId, searchParams, setSearchParams])

  const handleProjectSyncEvent = useCallback(
    (event: unknown) => {
      const parsedEvent = parseProjectSyncEvent(event)
      if (!parsedEvent) {
        return
      }

      if (!id) return
      if (parsedEvent.projectId !== id) return
      if (lastHandledSyncEventIdRef.current === parsedEvent.id) return
      lastHandledSyncEventIdRef.current = parsedEvent.id

      if (parsedEvent.type === 'project.deleted') {
        toast.info('This project was deleted in another session')
        navigate('/', { replace: true })
        return
      }

      const activeId = activeDocumentIdRef.current

      if (parsedEvent.type === 'chats.changed') {
        utils.chat.listByDocument.invalidate({
          projectId: id,
          documentId: parsedEvent.documentId,
        })
        return
      }

      utils.projects.get.invalidate({ id })
      utils.documents.list.invalidate({ projectId: id })

      if (activeId) {
        utils.documents.get.invalidate({ projectId: id, id: activeId })
        utils.documents.versions.invalidate({ projectId: id, id: activeId })
      }

      if (parsedEvent.type !== 'documents.changed' || !activeId) {
        return
      }

      if (!parsedEvent.deletedDocumentIds.includes(activeId)) {
        return
      }

      const redirectDocumentId = parsedEvent.defaultDocumentId
      if (redirectDocumentId && redirectDocumentId !== activeId) {
        const next = new URLSearchParams(searchParams)
        next.set('document', redirectDocumentId)
        setSearchParams(next, { replace: true })
        toast.info('The open document was removed. Switched to the default document.')
        return
      }

      if (openOrCreateDefaultDocumentMutation.isPending) {
        return
      }

      openOrCreateDefaultDocumentMutation.mutate(
        { projectId: id },
        {
          onSuccess: (document) => {
            const next = new URLSearchParams(searchParams)
            next.set('document', document.id)
            setSearchParams(next, { replace: true })
            toast.info('The open document was removed. A new default document was opened.')
          },
        }
      )
    },
    [
      id,
      navigate,
      openOrCreateDefaultDocumentMutation,
      searchParams,
      setSearchParams,
      utils.documents.get,
      utils.documents.list,
      utils.documents.versions,
      utils.chat.listByDocument,
      utils.projects.get,
    ]
  )

  trpc.sync.onProjectEvent.useSubscription(
    { projectId: id! },
    {
      enabled: !!id,
      onData: handleProjectSyncEvent,
    }
  )

  const toggleSidebar = useCallback(() => {
    const panel = sidebarPanelRef.current
    if (!panel) return
    const { asPercentage } = panel.getSize()
    if (asPercentage <= DESKTOP_SIDEBAR_OPEN_THRESHOLD_PERCENTAGE) {
      panel.resize(`${clampDesktopSidebarWidth(desktopSidebarWidthPercentage)}%`)
      setIsSidebarOpen(true)
    } else {
      setDesktopSidebarWidthPercentage((prevWidth) => {
        const nextWidth = clampDesktopSidebarWidth(asPercentage)
        if (Math.abs(prevWidth - nextWidth) < 0.1) return prevWidth
        return nextWidth
      })
      panel.collapse()
      setIsSidebarOpen(false)
    }
  }, [desktopSidebarWidthPercentage, setDesktopSidebarWidthPercentage, setIsSidebarOpen])

  const handleDesktopLayoutChanged = useCallback(
    (layout: Record<string, number>) => {
      const sidebarSize = layout[DESKTOP_SIDEBAR_PANEL_ID]
      if (typeof sidebarSize !== 'number' || !Number.isFinite(sidebarSize)) return

      const nextIsOpen = sidebarSize > DESKTOP_SIDEBAR_OPEN_THRESHOLD_PERCENTAGE
      setIsSidebarOpen((previous) => (previous === nextIsOpen ? previous : nextIsOpen))

      if (!nextIsOpen) return

      const nextWidth = clampDesktopSidebarWidth(sidebarSize)
      setDesktopSidebarWidthPercentage((previous) => {
        if (Math.abs(previous - nextWidth) < 0.1) return previous
        return nextWidth
      })
    },
    [setDesktopSidebarWidthPercentage, setIsSidebarOpen]
  )

  const handleMobileOpenDocument = useCallback(
    (documentId: string) => {
      handleOpenDocument(documentId)
      // Close mobile drawer if open
      if (isMobileMenuOpen) {
        setIsMobileMenuOpen(false)
      }
    },
    [handleOpenDocument, isMobileMenuOpen]
  )

  if (projectQuery.isLoading || (projectQuery.isFetching && !projectQuery.data)) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
      </div>
    )
  }

  if ((projectQuery.error || !projectQuery.data || !id) && !projectQuery.isFetching) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-destructive">{projectQuery.error?.message ?? 'Project not found'}</p>
        <Button variant="outline" onClick={() => navigate('/')}>
          Back to projects
        </Button>
      </div>
    )
  }

  if (!id || !projectQuery.data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
      </div>
    )
  }

  const project = projectQuery.data

  const versions: VersionSnapshotInfo[] = versionsQuery.data ?? []
  const hasDocuments = visibleDocuments.length > 0

  const sidebarContent = (
    <>
      {sidebarPanel === 'explorer' && (
        <DocumentBrowser
          projectId={id}
          documents={documentsQuery.data ?? []}
          isLoading={documentsQuery.isLoading || openOrCreateDefaultDocumentMutation.isPending}
          activeDocumentId={currentDocumentId ?? ''}
          onOpenDocument={handleMobileOpenDocument}
        />
      )}
      {sidebarPanel === 'chat' && (
        <ChatPanel
          editorSelection={editorSelectionForChat}
          projectId={id}
          documentId={currentDocumentId}
        />
      )}
    </>
  )

  const mainContent = (
    <main className="flex-1 overflow-y-auto h-full">
      {!hasDocuments &&
        !documentsQuery.isLoading &&
        !openOrCreateDefaultDocumentMutation.isPending && (
          <div className="text-muted-foreground flex h-full items-center justify-center px-6 text-sm">
            Create a document from the sidebar to start writing.
          </div>
        )}

      {(documentsQuery.isLoading || openOrCreateDefaultDocumentMutation.isPending) && (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="text-muted-foreground size-8 animate-spin" />
        </div>
      )}

      {hasDocuments && documentQuery.isLoading && (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="text-muted-foreground size-8 animate-spin" />
        </div>
      )}

      {hasDocuments && (documentQuery.error || !documentQuery.data) && !documentQuery.isLoading && (
        <div className="flex h-full flex-col items-center justify-center gap-4">
          <p className="text-destructive">{documentQuery.error?.message ?? 'Document not found'}</p>
          <Button
            variant="outline"
            onClick={() => {
              if (fallbackDocumentId) handleOpenDocument(fallbackDocumentId)
            }}
          >
            Open default document
          </Button>
        </div>
      )}

      {hasDocuments && documentQuery.data && !documentQuery.isLoading && currentDocumentId && (
        <div className="mx-auto max-w-3xl px-4 sm:px-8 py-6 sm:py-10">
          <Editor
            key={`${currentDocumentId}-${editorSessionKey}`}
            ref={editorRef}
            projectId={id}
            documentId={currentDocumentId}
            onConnectionChange={handleConnectionChange}
            onEditorSelectionChange={setEditorSelectionForChat}
            includeAfterContext={includeAfterContext}
            onIncludeAfterContextChange={setIncludeAfterContext}
            className="prose prose-neutral dark:prose-invert min-h-[70vh] max-w-none focus:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[70vh]"
          />
        </div>
      )}
    </main>
  )

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="border-b px-3 sm:px-4 py-2 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => navigate('/')}>
            <ArrowLeft className="size-4" />
          </Button>

          {/* Mobile menu toggle */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            onClick={() => setIsMobileMenuOpen((prev) => !prev)}
          >
            {isMobileMenuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </Button>

          {/* Desktop sidebar toggle */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden md:inline-flex"
            onClick={toggleSidebar}
          >
            {isSidebarOpen ? (
              <PanelLeftClose className="size-4" />
            ) : (
              <PanelLeft className="size-4" />
            )}
          </Button>

          <div className="min-w-0 flex-1 sm:flex-initial sm:max-w-sm">
            <Input
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={handleTitleKeyDown}
              autoComplete="off"
              disabled={!currentDocumentId || documentQuery.isLoading || !!documentQuery.error}
              className="w-full max-w-45 sm:max-w-xs border-none bg-transparent text-sm sm:text-base font-semibold shadow-none focus-visible:ring-0"
            />
          </div>

          <span className="text-muted-foreground hidden text-sm lg:inline truncate max-w-50">
            {project.title}
          </span>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <Badge variant={connectionStatus === 'disconnected' ? 'destructive' : 'secondary'}>
              {connectionStatus === 'connected' && (
                <>
                  <Wifi className="size-3" />
                  <span className="hidden sm:inline">Synced</span>
                </>
              )}
              {connectionStatus === 'connecting' && (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  <span className="hidden sm:inline">Syncing...</span>
                </>
              )}
              {connectionStatus === 'disconnected' && (
                <>
                  <WifiOff className="size-3" />
                  <span className="hidden sm:inline">Offline</span>
                </>
              )}
            </Badge>

            <VersionHistory
              versions={versions}
              onRestore={handleRestore}
              onCreateSnapshot={handleCreateSnapshot}
              isRestoring={restoreMutation.isPending}
              isCreatingSnapshot={createSnapshotMutation.isPending}
            />
          </div>
        </div>
      </header>

      {/* Main content area */}
      <div className="flex min-h-0 flex-1">
        {isDesktop ? (
          <div className="flex flex-1 min-h-0">
            <SidebarIconBar
              activePanel={sidebarPanel}
              onPanelChange={setSidebarPanel}
              isSidebarOpen={isSidebarOpen}
              onToggleSidebar={toggleSidebar}
            />

            <ResizablePanelGroup
              orientation="horizontal"
              className="flex-1"
              onLayoutChanged={handleDesktopLayoutChanged}
            >
              <ResizablePanel
                id={DESKTOP_SIDEBAR_PANEL_ID}
                panelRef={sidebarPanelRef}
                defaultSize={
                  isSidebarOpen
                    ? `${clampDesktopSidebarWidth(desktopSidebarWidthPercentage)}%`
                    : '0%'
                }
                minSize={`${DESKTOP_SIDEBAR_MIN_WIDTH_PERCENTAGE}%`}
                maxSize={`${DESKTOP_SIDEBAR_MAX_WIDTH_PERCENTAGE}%`}
                collapsible
                collapsedSize="0%"
                className="transition-[flex-basis] duration-300 ease-in-out"
              >
                <div
                  className={cn(
                    'h-full overflow-hidden border-r transition-opacity duration-300 ease-in-out',
                    isSidebarOpen ? 'opacity-100 delay-150' : 'opacity-0'
                  )}
                >
                  {sidebarContent}
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />

              {/* Editor panel */}
              <ResizablePanel
                id="desktop-main"
                defaultSize={
                  isSidebarOpen
                    ? `${100 - clampDesktopSidebarWidth(desktopSidebarWidthPercentage)}%`
                    : '100%'
                }
              >
                {mainContent}
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0 relative">
            {/* Mobile sidebar overlay */}
            <div
              className={cn(
                'absolute inset-0 z-40 transition-all duration-300 ease-out',
                isMobileMenuOpen ? 'pointer-events-auto' : 'pointer-events-none'
              )}
            >
              {/* Backdrop */}
              <div
                className={cn(
                  'absolute inset-0 bg-black/40 transition-opacity duration-300',
                  isMobileMenuOpen ? 'opacity-100' : 'opacity-0'
                )}
                onClick={() => setIsMobileMenuOpen(false)}
              />

              {/* Sidebar drawer */}
              <div
                className={cn(
                  'absolute inset-y-0 left-0 flex w-[85%] max-w-sm bg-background transition-transform duration-300 ease-out',
                  isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
                )}
              >
                <SidebarIconBar
                  activePanel={sidebarPanel}
                  onPanelChange={setSidebarPanel}
                  isSidebarOpen={true}
                  onToggleSidebar={() => setIsMobileMenuOpen(false)}
                />
                <div className="flex-1 bg-background overflow-hidden">{sidebarContent}</div>
              </div>
            </div>

            {/* Mobile main content */}
            {mainContent}
          </div>
        )}
      </div>
    </div>
  )
}
