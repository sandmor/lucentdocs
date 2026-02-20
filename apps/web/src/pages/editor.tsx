import { useRef, useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { trpc } from '@/lib/trpc'
import { parseContent, serializeContent } from '@/lib/prosemirror'
import { Editor, type EditorHandle } from '@/components/editor'
import { AiPanel } from '@/components/editor/ai-panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { ArrowLeft, Check, Loader2, PanelRightOpen, PanelRightClose } from 'lucide-react'

const AUTOSAVE_DELAY = 2000

export function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const editorRef = useRef<EditorHandle>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedContentRef = useRef<string>('')
  const lastSavedTitleRef = useRef<string>('')

  const [title, setTitle] = useState('')
  const [showAi, setShowAi] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [isGenerating, setIsGenerating] = useState(false)
  const [includeAfterContext, setIncludeAfterContext] = useState(false)

  const projectQuery = trpc.projects.get.useQuery({ id: id! }, { enabled: !!id })

  const updateMutation = trpc.projects.update.useMutation()

  useEffect(() => {
    if (projectQuery.data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTitle(projectQuery.data.title)
      lastSavedContentRef.current = projectQuery.data.content
      lastSavedTitleRef.current = projectQuery.data.title
    }
  }, [projectQuery.data])

  const save = useCallback(() => {
    if (!id || !editorRef.current || updateMutation.isPending) return
    const content = serializeContent(editorRef.current.getPersistedContent())
    if (content === lastSavedContentRef.current && title === lastSavedTitleRef.current) {
      setSaveStatus('saved')
      return
    }

    const nextTitle = title
    const nextContent = content

    setSaveStatus('saving')
    updateMutation.mutate(
      { id, title: nextTitle, content: nextContent },
      {
        onSuccess: () => {
          lastSavedContentRef.current = nextContent
          lastSavedTitleRef.current = nextTitle
          setSaveStatus('saved')
        },
        onError: () => {
          setSaveStatus('unsaved')
        },
      }
    )
  }, [id, title, updateMutation])

  const handleContentChange = useCallback(() => {
    setSaveStatus('unsaved')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      save()
    }, AUTOSAVE_DELAY)
  }, [save])

  const handleTitleBlur = useCallback(() => {
    if (id && title.trim() && title !== lastSavedTitleRef.current) {
      const nextTitle = title.trim()
      setSaveStatus('saving')
      updateMutation.mutate(
        { id, title: nextTitle },
        {
          onSuccess: () => {
            lastSavedTitleRef.current = nextTitle
            setSaveStatus('saved')
          },
          onError: () => {
            setSaveStatus('unsaved')
          },
        }
      )
    }
  }, [id, title, updateMutation])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        save()
      }

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
  }, [save])

  const handleStreamingChange = useCallback((streaming: boolean) => {
    setIsGenerating(streaming)
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

  const parsedContent = parseContent(projectQuery.data.content)

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => navigate('/')}>
            <ArrowLeft className="size-4" />
          </Button>

          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            className="max-w-xs border-none bg-transparent text-base font-semibold shadow-none focus-visible:ring-0"
          />

          <div className="flex items-center gap-2 ml-auto">
            <span className="text-muted-foreground flex items-center gap-1 text-xs">
              {saveStatus === 'saving' && (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Saving...
                </>
              )}
              {saveStatus === 'saved' && (
                <>
                  <Check className="size-3" />
                  Saved
                </>
              )}
              {saveStatus === 'unsaved' && 'Unsaved changes'}
            </span>

            <Separator orientation="vertical" className="h-6" />

            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowAi((v) => !v)}
              title="Toggle AI panel"
            >
              {showAi ? (
                <PanelRightClose className="size-4" />
              ) : (
                <PanelRightOpen className="size-4" />
              )}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-8 py-10">
            <Editor
              ref={editorRef}
              initialContent={parsedContent.doc}
              initialAIDraft={parsedContent.aiDraft}
              onChange={handleContentChange}
              onStreamingChange={handleStreamingChange}
              includeAfterContext={includeAfterContext}
              className="prose prose-neutral dark:prose-invert min-h-[70vh] max-w-none focus:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[70vh]"
            />
          </div>
        </main>

        {showAi && (
          <>
            <Separator orientation="vertical" />
            <aside className="w-80 shrink-0 overflow-y-auto border-l">
              <AiPanel
                onContinue={() => editorRef.current?.startAIContinuation()}
                onGenerate={(prompt) => editorRef.current?.startAIPrompt(prompt)}
                isGenerating={isGenerating}
                includeAfterContext={includeAfterContext}
                onIncludeAfterContextChange={setIncludeAfterContext}
              />
            </aside>
          </>
        )}
      </div>
    </div>
  )
}
