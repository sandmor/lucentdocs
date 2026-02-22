import {
  useRef,
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useParams, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { trpc } from '@/lib/trpc'
import { Editor, type EditorHandle } from '@/components/editor'
import { VersionHistory, type VersionSnapshotInfo } from '@/components/version-history'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Loader2, Wifi, WifiOff } from 'lucide-react'
import type { ConnectionStatus } from '@/lib/yjs-provider'

export function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const editorRef = useRef<EditorHandle>(null)
  const lastSavedTitleRef = useRef<string | null>(null)
  const activeProjectIdRef = useRef<string | null>(null)

  const [includeAfterContext, setIncludeAfterContext] = useState(true)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')
  const [titleInput, setTitleInput] = useState('')
  const [editorSessionKey, setEditorSessionKey] = useState(0)

  const projectQuery = trpc.projects.get.useQuery({ id: id! }, { enabled: !!id })
  const versionsQuery = trpc.projects.versions.useQuery({ id: id! }, { enabled: !!id })

  const updateMutation = trpc.projects.update.useMutation()
  const restoreMutation = trpc.projects.restore.useMutation()
  const createSnapshotMutation = trpc.projects.createSnapshot.useMutation()
  const utils = trpc.useUtils()

  const projectTitle = projectQuery.data?.title

  useEffect(() => {
    if (!id) return
    if (activeProjectIdRef.current === id) return

    activeProjectIdRef.current = id
    lastSavedTitleRef.current = null
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTitleInput('')
    setConnectionStatus('connecting')
  }, [id])

  useEffect(() => {
    if (!id || projectQuery.data?.id !== id) return

    if (projectTitle === undefined) return

    if (lastSavedTitleRef.current === null) {
      lastSavedTitleRef.current = projectTitle
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTitleInput(projectTitle)
      return
    }

    if (projectTitle !== lastSavedTitleRef.current && titleInput === lastSavedTitleRef.current) {
      lastSavedTitleRef.current = projectTitle
      setTitleInput(projectTitle)
    }
  }, [id, projectQuery.data?.id, projectTitle, titleInput])

  const commitTitle = useCallback(() => {
    if (!id || updateMutation.isPending) return

    const trimmedTitle = titleInput.trim()
    if (!trimmedTitle) {
      setTitleInput(lastSavedTitleRef.current ?? projectTitle ?? '')
      return
    }

    if (trimmedTitle === lastSavedTitleRef.current) {
      if (trimmedTitle !== titleInput) {
        setTitleInput(trimmedTitle)
      }
      return
    }

    updateMutation.mutate(
      { id, title: trimmedTitle },
      {
        onSuccess: (project) => {
          lastSavedTitleRef.current = project.title
          setTitleInput(project.title)
          utils.projects.get.setData({ id }, project)
          utils.projects.list.setData(undefined, (projects) =>
            projects?.map((item) =>
              item.id === id
                ? { ...item, title: project.title, updatedAt: project.updatedAt }
                : item
            )
          )
        },
        onError: (error) => {
          setTitleInput(lastSavedTitleRef.current ?? projectTitle ?? '')
          toast.error('Failed to update project title', {
            description: error.message,
          })
        },
      }
    )
  }, [id, projectTitle, titleInput, updateMutation, utils])

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
        setTitleInput(lastSavedTitleRef.current ?? projectTitle ?? '')
        e.currentTarget.blur()
      }
    },
    [commitTitle, projectTitle]
  )

  const handleRestore = useCallback(
    (snapshotId: string) => {
      if (!id) return
      restoreMutation.mutate(
        { id, snapshotId },
        {
          onSuccess: () => {
            setEditorSessionKey((value) => value + 1)
            utils.projects.get.invalidate({ id })
            utils.projects.versions.invalidate({ id })
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
    [id, restoreMutation, utils]
  )

  const handleCreateSnapshot = useCallback(() => {
    if (!id) return
    createSnapshotMutation.mutate(
      { id },
      {
        onSuccess: () => {
          utils.projects.versions.invalidate({ id })
          toast.success('Snapshot created')
        },
        onError: (error) => {
          toast.error('Failed to create snapshot', {
            description: error.message,
          })
        },
      }
    )
  }, [id, createSnapshotMutation, utils])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const activeElement = document.activeElement as HTMLElement | null
        const isEditorFocused = Boolean(activeElement?.closest('.ProseMirror'))
        if (!isEditorFocused) return

        e.preventDefault()
        editorRef.current?.startAIContinuation()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleConnectionChange = useCallback((status: ConnectionStatus) => {
    setConnectionStatus(status)
  }, [])

  if (projectQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
      </div>
    )
  }

  if (projectQuery.error || !projectQuery.data) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-destructive">{projectQuery.error?.message ?? 'Project not found'}</p>
        <Button variant="outline" onClick={() => navigate('/')}>
          Back to projects
        </Button>
      </div>
    )
  }

  const documentId = projectQuery.data.documentId
  const versions: VersionSnapshotInfo[] = versionsQuery.data ?? []

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => navigate('/')}>
            <ArrowLeft className="size-4" />
          </Button>

          <Input
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            autoComplete="off"
            className="max-w-xs border-none bg-transparent text-base font-semibold shadow-none focus-visible:ring-0"
          />

          <div className="flex items-center gap-2 ml-auto">
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

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-10">
          <Editor
            key={`${documentId}-${editorSessionKey}`}
            ref={editorRef}
            documentId={documentId}
            onConnectionChange={handleConnectionChange}
            includeAfterContext={includeAfterContext}
            onIncludeAfterContextChange={setIncludeAfterContext}
            className="prose prose-neutral dark:prose-invert min-h-[70vh] max-w-none focus:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[70vh]"
          />
        </div>
      </main>
    </div>
  )
}
