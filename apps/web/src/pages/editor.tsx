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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Loader2, Wifi, WifiOff } from 'lucide-react'
import type { ConnectionStatus } from '@/lib/yjs-provider'

export function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const editorRef = useRef<EditorHandle>(null)
  const lastSavedPathRef = useRef<string | null>(null)
  const activeDocumentIdRef = useRef<string | null>(null)
  const autoOpenAttemptedProjectRef = useRef<string | null>(null)
  const persistedDefaultSignatureRef = useRef<string | null>(null)

  const [includeAfterContext, setIncludeAfterContext] = useState(true)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')
  const [titleInput, setTitleInput] = useState('')
  const [editorSessionKey, setEditorSessionKey] = useState(0)

  const projectQuery = trpc.projects.get.useQuery({ id: id! }, { enabled: !!id })
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

    if (defaultDocumentIdFromProject && visibleDocuments.some((doc) => doc.id === defaultDocumentIdFromProject)) {
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
    setTitleInput('')
    setConnectionStatus('connecting')
  }, [currentDocumentId])

  useEffect(() => {
    if (!currentDocumentId || documentQuery.data?.id !== currentDocumentId) return
    if (!documentPath) return

    if (lastSavedPathRef.current === null) {
      lastSavedPathRef.current = documentPath
      setTitleInput(documentBaseName)
      return
    }

    const lastSavedBaseName = (() => {
      const parts = pathSegments(lastSavedPathRef.current)
      return parts.at(-1) ?? ''
    })()

    if (documentPath !== lastSavedPathRef.current && titleInput === lastSavedBaseName) {
      lastSavedPathRef.current = documentPath
      setTitleInput(documentBaseName)
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
        editorRef.current?.startAIContinuationAtStoryEnd()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

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

  if (projectQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
      </div>
    )
  }

  if (projectQuery.error || !projectQuery.data || !id) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-destructive">{projectQuery.error?.message ?? 'Project not found'}</p>
        <Button variant="outline" onClick={() => navigate('/')}>
          Back to projects
        </Button>
      </div>
    )
  }

  const versions: VersionSnapshotInfo[] = versionsQuery.data ?? []
  const hasDocuments = visibleDocuments.length > 0

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => navigate('/')}>
            <ArrowLeft className="size-4" />
          </Button>

          <div className="min-w-0 max-w-sm">
            <Input
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={handleTitleKeyDown}
              autoComplete="off"
              disabled={!currentDocumentId || documentQuery.isLoading || !!documentQuery.error}
              className="max-w-xs border-none bg-transparent text-base font-semibold shadow-none focus-visible:ring-0"
            />
          </div>

          <span className="text-muted-foreground hidden text-sm md:inline">{projectQuery.data.title}</span>

          <div className="ml-auto flex items-center gap-2">
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

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <DocumentBrowser
          projectId={id}
          documents={documentsQuery.data ?? []}
          isLoading={documentsQuery.isLoading || openOrCreateDefaultDocumentMutation.isPending}
          activeDocumentId={currentDocumentId ?? ''}
          onOpenDocument={handleOpenDocument}
        />

        <main className="flex-1 overflow-y-auto">
          {!hasDocuments &&
            !documentsQuery.isLoading &&
            !openOrCreateDefaultDocumentMutation.isPending && (
            <div className="text-muted-foreground flex h-full items-center justify-center px-6 text-sm">
              Create a document from the left panel to start writing.
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
            <div className="mx-auto max-w-3xl px-8 py-10">
              <Editor
                key={`${currentDocumentId}-${editorSessionKey}`}
                ref={editorRef}
                documentId={currentDocumentId}
                onConnectionChange={handleConnectionChange}
                includeAfterContext={includeAfterContext}
                onIncludeAfterContextChange={setIncludeAfterContext}
                className="prose prose-neutral dark:prose-invert min-h-[70vh] max-w-none focus:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[70vh]"
              />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
