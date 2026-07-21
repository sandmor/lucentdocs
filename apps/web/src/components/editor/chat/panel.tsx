import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type UIMessage } from 'ai'
import {
  StopCircle,
  Trash2,
  Plus,
  History,
  CornerDownLeft,
  PenTool,
  Search,
  AtSign,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { asUIMessageArray, getTrailingAssistantMessage } from './message-utils'
import { canContinueConversation, getBranchMeta, type ChatTreeSnapshot } from './tree'
import type { ChatThreadSummary } from './types'
import { ChatBubble, EmptyChatState, ThreadRow, type DeleteChatMessageMode } from './ui'
import { useChatStreamPump } from './use-stream-pump'
import { useEditorStore } from '@/lib/editor-store'

interface ChatPanelProps {
  projectId?: string
  documentId: string | null
  className?: string
}

export function ChatPanel({ projectId, documentId, className }: ChatPanelProps) {
  const editorSelection = useEditorStore((s) => s.editorSelection)
  const utils = trpc.useUtils()
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [tree, setTree] = useState<ChatTreeSnapshot | null>(null)
  const treeRef = useRef<ChatTreeSnapshot | null>(null)
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isThreadBrowserOpen, setIsThreadBrowserOpen] = useState(false)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [draftEditingEnabled, setDraftEditingEnabled] = useState(true)
  const [historyFilter, setHistoryFilter] = useState('')
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false)
  const [attachedDocumentIds, setAttachedDocumentIds] = useState<string[]>([])
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldStickToBottomRef = useRef(true)
  const activeThreadIdRef = useRef<string | null>(null)
  const messagesRef = useRef<UIMessage[]>([])
  const isGeneratingRef = useRef(false)
  const lastGenerationErrorRef = useRef<string | null>(null)
  const preferenceSeededProjectRef = useRef<string | null>(null)

  const queryEnabled = Boolean(projectId)

  const threadsQuery = trpc.chat.listByProject.useQuery(
    { projectId: projectId ?? '' },
    { enabled: queryEnabled }
  )
  const assistantPreferencesQuery = trpc.assistantPreferences.getProject.useQuery(
    { projectId: projectId ?? '' },
    { enabled: queryEnabled }
  )
  const documentsQuery = trpc.documents.list.useQuery(
    { projectId: projectId ?? '' },
    { enabled: Boolean(projectId) }
  )
  const attachedDocuments = useMemo(
    () =>
      attachedDocumentIds.flatMap((attachmentId) => {
        const document = documentsQuery.data?.find((entry) => entry.id === attachmentId)
        return document ? [document] : []
      }),
    [attachedDocumentIds, documentsQuery.data]
  )

  const threads = useMemo(() => threadsQuery.data?.threads ?? [], [threadsQuery.data?.threads])
  const hasActiveThreadId = Boolean(
    activeThreadId && threads.some((thread) => thread.id === activeThreadId)
  )
  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [threads, activeThreadId]
  )
  const visibleThreads = useMemo(() => {
    const query = historyFilter.trim().toLocaleLowerCase()
    if (!query) return threads
    return threads.filter((thread) => thread.title.toLocaleLowerCase().includes(query))
  }, [historyFilter, threads])
  // Threads are project-owned. The active editor document is only the current
  // tool/context target, so project history has no persistent document owner.
  const activeThreadDocumentId = activeThread?.documentId || documentId
  const operationDocumentId = activeThreadDocumentId

  const activeThreadQuery = trpc.chat.getById.useQuery(
    {
      projectId: projectId ?? '',
      documentId: activeThreadDocumentId ?? '',
      chatId: activeThreadId ?? '',
    },
    {
      enabled: queryEnabled && hasActiveThreadId && Boolean(activeThreadDocumentId),
    }
  )

  const createThreadMutation = trpc.chat.create.useMutation()
  const deleteThreadMutation = trpc.chat.deleteById.useMutation()
  const updateSettingsMutation = trpc.chat.updateSettings.useMutation()
  const updateMessageMutation = trpc.chat.updateMessageById.useMutation()
  const editMessageAndGenerateMutation = trpc.chat.editMessageAndGenerate.useMutation()
  const deleteMessagesMutation = trpc.chat.deleteMessagesById.useMutation()
  const selectBranchMutation = trpc.chat.selectBranch.useMutation()
  const regenerateMutation = trpc.chat.regenerateFromMessage.useMutation()
  const generateMutation = trpc.chat.generateById.useMutation()
  const cancelGenerationMutation = trpc.chat.cancelGenerationById.useMutation()

  const editingEnabled = hasActiveThreadId
    ? (activeThreadQuery.data?.settings.editingEnabled ?? false)
    : draftEditingEnabled

  useEffect(() => {
    if (
      !hasActiveThreadId &&
      assistantPreferencesQuery.data &&
      preferenceSeededProjectRef.current !== projectId
    ) {
      setDraftEditingEnabled(assistantPreferencesQuery.data.resolved.defaultMode === 'agent')
      preferenceSeededProjectRef.current = projectId ?? null
    }
  }, [assistantPreferencesQuery.data, hasActiveThreadId, projectId])

  const { streamGenerationIdRef, enqueueStreamChunk, stopStreamChunkPump, startStreamChunkPump } =
    useChatStreamPump({
      isThreadActive: (chatId) => activeThreadIdRef.current === chatId,
      onAssistantMessage: (updater) =>
        setMessages((previous) => {
          const next = updater(previous)
          messagesRef.current = next
          return next
        }),
      onGeneratingChange: (generating) => {
        isGeneratingRef.current = generating
        setIsGenerating(generating)
      },
    })

  const resetLocalChatState = useCallback(
    (
      options: {
        clearInput?: boolean
        clearThread?: boolean
        closeThreadBrowser?: boolean
      } = {}
    ) => {
      setMessages([])
      setTree(null)
      treeRef.current = null
      setIsGenerating(false)
      messagesRef.current = []
      isGeneratingRef.current = false
      lastGenerationErrorRef.current = null
      setEditingMessageId(null)
      if (options.clearInput) {
        setInput('')
      }
      if (options.clearThread) {
        setActiveThreadId(null)
        setDraftEditingEnabled(false)
      }
      if (options.closeThreadBrowser) {
        setIsThreadBrowserOpen(false)
      }
      stopStreamChunkPump()
    },
    [stopStreamChunkPump]
  )

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId
    lastGenerationErrorRef.current = null
  }, [activeThreadId])

  useEffect(() => {
    if (!queryEnabled) return

    let cancelled = false

    if (threads.length === 0 && activeThreadId !== null) {
      queueMicrotask(() => {
        if (cancelled) return
        resetLocalChatState({ clearInput: true, clearThread: true })
      })
    } else if (activeThreadId && !threads.some((thread) => thread.id === activeThreadId)) {
      queueMicrotask(() => {
        if (cancelled) return
        resetLocalChatState({ clearThread: true })
      })
    }

    return () => {
      cancelled = true
    }
  }, [activeThreadId, queryEnabled, resetLocalChatState, threads])

  useEffect(() => {
    if (!activeThreadId || !activeThreadQuery.data) return

    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return
      const nextMessages = asUIMessageArray(activeThreadQuery.data.messages)
      const nextTree = activeThreadQuery.data.tree ?? null
      const nextGenerating = Boolean(activeThreadQuery.data.generating)
      messagesRef.current = nextMessages
      treeRef.current = nextTree
      isGeneratingRef.current = nextGenerating
      setMessages(nextMessages)
      setTree(nextTree)
      setIsGenerating(nextGenerating)
      if (!activeThreadQuery.data.generating) {
        stopStreamChunkPump()
      }
    })

    return () => {
      cancelled = true
    }
  }, [activeThreadId, activeThreadQuery.data, stopStreamChunkPump])

  trpc.chat.observeById.useSubscription(
    {
      projectId: projectId ?? '',
      documentId: operationDocumentId ?? '',
      chatId: activeThreadId ?? '',
    },
    {
      enabled: queryEnabled && Boolean(activeThreadId && operationDocumentId),
      onData: (event) => {
        if (!projectId || !operationDocumentId || !activeThreadId) return
        if (event.chatId !== activeThreadIdRef.current) return

        if (event.type === 'stream-chunk') {
          if (streamGenerationIdRef.current !== event.generationId) {
            const seedAssistant = isGeneratingRef.current
              ? getTrailingAssistantMessage(messagesRef.current)
              : null
            startStreamChunkPump(event.generationId, seedAssistant, event.chatId)
          }

          enqueueStreamChunk(event.chunk)
          return
        }

        if (event.deleted) {
          resetLocalChatState({ clearThread: true })
          utils.chat.listByProject.setData({ projectId }, (previous) => {
            const current = previous?.threads ?? []
            return { threads: current.filter((thread) => thread.id !== activeThreadId) }
          })
          void utils.chat.getById.invalidate({
            projectId,
            documentId: operationDocumentId,
            chatId: activeThreadId,
          })
          return
        }

        if (!event.thread) return

        const nextMessages = asUIMessageArray(event.thread.messages)
        const nextTree = event.thread.tree ?? null
        messagesRef.current = nextMessages
        treeRef.current = nextTree
        isGeneratingRef.current = event.generating
        setMessages(nextMessages)
        setTree(nextTree)
        setIsGenerating(event.generating)
        const trailingAssistant = getTrailingAssistantMessage(nextMessages)

        if (event.generating && event.generationId) {
          lastGenerationErrorRef.current = null
          if (streamGenerationIdRef.current !== event.generationId) {
            startStreamChunkPump(event.generationId, trailingAssistant, event.chatId)
          }
        } else {
          stopStreamChunkPump()
        }

        const nextThreadSummary: ChatThreadSummary = {
          id: event.thread.id,
          documentId: operationDocumentId,
          title: event.thread.title,
          createdAt: event.thread.createdAt,
          updatedAt: event.thread.updatedAt,
          messageCount: nextMessages.length,
        }

        utils.chat.getById.setData(
          { projectId, documentId: operationDocumentId, chatId: event.thread.id },
          {
            id: event.thread.id,
            title: event.thread.title,
            messages: nextMessages,
            tree: nextTree,
            settings: event.thread.settings,
            createdAt: event.thread.createdAt,
            updatedAt: event.thread.updatedAt,
            generating: event.generating,
          }
        )

        utils.chat.listByProject.setData({ projectId }, (previous) => {
          const current = previous?.threads ?? []
          if (current.some((thread) => thread.id === nextThreadSummary.id)) {
            return {
              threads: current
                .map((thread) => (thread.id === nextThreadSummary.id ? nextThreadSummary : thread))
                .sort((left, right) => right.updatedAt - left.updatedAt),
            }
          }

          return {
            threads: [nextThreadSummary, ...current].sort(
              (left, right) => right.updatedAt - left.updatedAt
            ),
          }
        })

        if (event.error) {
          const errorKey = `${event.chatId}:${event.thread.updatedAt}:${event.error}`
          if (lastGenerationErrorRef.current !== errorKey) {
            lastGenerationErrorRef.current = errorKey
            toast.error('AI Chat Error', { description: event.error })
          }
        }
      },
      onError: (error) => {
        toast.error('Chat subscription error', { description: error.message })
      },
    }
  )

  useEffect(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement) return

    const updateStickiness = () => {
      const bottomDistance =
        scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight
      shouldStickToBottomRef.current = bottomDistance <= 80
    }

    updateStickiness()
    scrollElement.addEventListener('scroll', updateStickiness, { passive: true })
    return () => {
      scrollElement.removeEventListener('scroll', updateStickiness)
    }
  }, [])

  useEffect(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement || !shouldStickToBottomRef.current) return

    const rafId = requestAnimationFrame(() => {
      scrollElement.scrollTop = scrollElement.scrollHeight
    })
    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [messages])

  const createThread = useCallback(async () => {
    if (!projectId || !documentId) return null
    try {
      const created = await createThreadMutation.mutateAsync({ projectId, documentId, editingEnabled: draftEditingEnabled })
      utils.chat.listByProject.setData({ projectId }, (previous) => {
        const existing = previous?.threads ?? []
        return {
          threads: [
            {
              id: created.id,
              documentId: created.documentId,
              title: created.title,
              createdAt: created.createdAt,
              updatedAt: created.updatedAt,
              messageCount: created.messages.length,
            },
            ...existing.filter((thread) => thread.id !== created.id),
          ],
        }
      })
      return created.id
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create chat thread'
      toast.error('Chat Error', { description: message })
      return null
    }
  }, [createThreadMutation, documentId, draftEditingEnabled, projectId, utils.chat.listByProject])

  const deleteThread = useCallback(
    async (threadId: string) => {
      const threadDocumentId = threads.find((thread) => thread.id === threadId)?.documentId
      if (!projectId || !threadDocumentId) return
      if (isGenerating && threadId === activeThreadId) return

      try {
        await deleteThreadMutation.mutateAsync({
          projectId,
          documentId: threadDocumentId,
          chatId: threadId,
        })
        utils.chat.listByProject.setData({ projectId }, (previous) => {
          const current = previous?.threads ?? []
          return { threads: current.filter((thread) => thread.id !== threadId) }
        })

        if (activeThreadId === threadId) {
          resetLocalChatState({ clearInput: true, clearThread: true })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete chat thread'
        toast.error('Chat Error', { description: message })
      }
    },
    [
      activeThreadId,
      deleteThreadMutation,
      threads,
      isGenerating,
      projectId,
      resetLocalChatState,
      utils.chat.listByProject,
    ]
  )

  const applyTreeUpdate = useCallback(
    (updated: {
      id: string
      messages: unknown[]
      tree?: ChatTreeSnapshot
      settings: { editingEnabled: boolean }
      updatedAt: number
    }) => {
      if (!projectId || !operationDocumentId) return
      const nextMessages = asUIMessageArray(updated.messages)
      const nextTree = updated.tree ?? treeRef.current
      messagesRef.current = nextMessages
      treeRef.current = nextTree
      setMessages(nextMessages)
      setTree(nextTree)
      utils.chat.getById.setData(
        { projectId, documentId: operationDocumentId, chatId: updated.id },
        (previous) =>
          previous
            ? {
                ...previous,
                messages: nextMessages,
                tree: nextTree ?? previous.tree,
                settings: updated.settings,
                updatedAt: updated.updatedAt,
              }
            : previous
      )
      utils.chat.listByProject.setData({ projectId }, (previous) => ({
        threads: (previous?.threads ?? []).map((thread) =>
          thread.id === updated.id
            ? {
                ...thread,
                messageCount: nextMessages.length,
                updatedAt: updated.updatedAt,
              }
            : thread
        ),
      }))
    },
    [operationDocumentId, projectId, utils.chat.getById, utils.chat.listByProject]
  )

  const handleSaveMessageOnly = useCallback(
    async (messageId: string, text: string) => {
      if (!projectId || !operationDocumentId || !activeThreadId || isGenerating) return
      try {
        const updated = await updateMessageMutation.mutateAsync({
          projectId,
          documentId: operationDocumentId,
          chatId: activeThreadId,
          messageId,
          text,
        })
        applyTreeUpdate(updated)
        setEditingMessageId(null)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to edit message'
        toast.error('Failed to edit message', { description: message })
      }
    },
    [
      activeThreadId,
      applyTreeUpdate,
      operationDocumentId,
      isGenerating,
      projectId,
      updateMessageMutation,
    ]
  )

  const handleSaveMessageAndGenerate = useCallback(
    async (messageId: string, text: string) => {
      if (!projectId || !operationDocumentId || !activeThreadId || isGenerating) return
      try {
        isGeneratingRef.current = true
        setIsGenerating(true)
        setEditingMessageId(null)
        await editMessageAndGenerateMutation.mutateAsync({
          projectId,
          documentId: operationDocumentId,
          chatId: activeThreadId,
          messageId,
          text,
          selectionFrom: editorSelection?.from,
          selectionTo: editorSelection?.to,
        })
      } catch (error) {
        isGeneratingRef.current = false
        setIsGenerating(false)
        const message =
          error instanceof Error ? error.message : 'Failed to save and generate response'
        toast.error('AI Chat Error', { description: message })
      }
    },
    [
      activeThreadId,
      operationDocumentId,
      editMessageAndGenerateMutation,
      editorSelection,
      isGenerating,
      projectId,
    ]
  )

  const handleDeleteMessages = useCallback(
    async (messageId: string, mode: DeleteChatMessageMode) => {
      if (!projectId || !operationDocumentId || !activeThreadId || isGenerating) return
      try {
        const updated = await deleteMessagesMutation.mutateAsync({
          projectId,
          documentId: operationDocumentId,
          chatId: activeThreadId,
          messageId,
          mode,
        })
        applyTreeUpdate(updated)
        setEditingMessageId(null)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete message'
        toast.error('Failed to delete message', { description: message })
      }
    },
    [
      activeThreadId,
      applyTreeUpdate,
      deleteMessagesMutation,
      operationDocumentId,
      isGenerating,
      projectId,
    ]
  )

  const handleSelectBranch = useCallback(
    async (nodeId: string) => {
      if (!projectId || !operationDocumentId || !activeThreadId || isGenerating) return
      try {
        const updated = await selectBranchMutation.mutateAsync({
          projectId,
          documentId: operationDocumentId,
          chatId: activeThreadId,
          nodeId,
        })
        applyTreeUpdate(updated)
        setEditingMessageId(null)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to switch branch'
        toast.error('Failed to switch branch', { description: message })
      }
    },
    [
      activeThreadId,
      applyTreeUpdate,
      operationDocumentId,
      isGenerating,
      projectId,
      selectBranchMutation,
    ]
  )

  const handleRegenerate = useCallback(
    async (messageId: string) => {
      if (!projectId || !operationDocumentId || !activeThreadId || isGenerating) return
      try {
        isGeneratingRef.current = true
        setIsGenerating(true)
        await regenerateMutation.mutateAsync({
          projectId,
          documentId: operationDocumentId,
          chatId: activeThreadId,
          messageId,
          selectionFrom: editorSelection?.from,
          selectionTo: editorSelection?.to,
        })
      } catch (error) {
        isGeneratingRef.current = false
        setIsGenerating(false)
        const message = error instanceof Error ? error.message : 'Failed to regenerate message'
        toast.error('Failed to regenerate message', { description: message })
      }
    },
    [
      activeThreadId,
      operationDocumentId,
      editorSelection,
      isGenerating,
      projectId,
      regenerateMutation,
    ]
  )

  const handleStop = async () => {
    if (!projectId || !operationDocumentId || !activeThreadId || !isGenerating) return

    try {
      await cancelGenerationMutation.mutateAsync({
        projectId,
        documentId: operationDocumentId,
        chatId: activeThreadId,
        generationId: streamGenerationIdRef.current ?? undefined,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop generation'
      toast.error('AI Chat Error', { description: message })
    }
  }

  const canContinue = useMemo(
    () => Boolean(activeThreadId && canContinueConversation(messages)),
    [activeThreadId, messages]
  )

  const canSend = useMemo(
    () =>
      Boolean(
        queryEnabled &&
        !isGenerating &&
        !generateMutation.isPending &&
        !selectBranchMutation.isPending &&
        !regenerateMutation.isPending &&
        !editMessageAndGenerateMutation.isPending &&
        (input.trim() || canContinue)
      ),
    [
      queryEnabled,
      isGenerating,
      generateMutation.isPending,
      selectBranchMutation.isPending,
      regenerateMutation.isPending,
      editMessageAndGenerateMutation.isPending,
      input,
      canContinue,
    ]
  )

  const handleSend = async () => {
    const trimmed = input.trim()
    const continuing = !trimmed && canContinue

    if ((!trimmed && !continuing) || !projectId || !documentId || isGenerating) return
    let targetDocumentId: string = operationDocumentId ?? documentId

    if (continuing) {
      if (!activeThreadId) return

      try {
        isGeneratingRef.current = true
        setIsGenerating(true)
        await generateMutation.mutateAsync({
          projectId,
          documentId: targetDocumentId,
          chatId: activeThreadId,
          message: '',
          contextDocumentId: documentId,
          selectionFrom: editorSelection?.from,
          selectionTo: editorSelection?.to,
        })
      } catch (error) {
        isGeneratingRef.current = false
        setIsGenerating(false)
        const message =
          error instanceof Error ? error.message : 'Failed to start AI response generation'
        toast.error('AI Chat Error', { description: message })
      }
      return
    }

    let targetChatId = activeThreadId
    const initialEditingEnabled = draftEditingEnabled

    if (!targetChatId) {
      const newChatId = await createThread()
      if (!newChatId) return
      targetChatId = newChatId
      targetDocumentId = documentId
      setActiveThreadId(newChatId)

      try {
        const updated = await updateSettingsMutation.mutateAsync({
          projectId,
          documentId: targetDocumentId,
          chatId: newChatId,
          editingEnabled: initialEditingEnabled,
        })
        utils.chat.getById.setData(
          { projectId, documentId: targetDocumentId, chatId: newChatId },
          (previous) => {
            if (!previous) {
              return {
                id: newChatId,
                title: 'New chat',
                messages: [],
                tree: {
                  nodes: {},
                  rootChildIds: [],
                  selectedRootChildId: null,
                },
                settings: updated.settings,
                createdAt: Date.now(),
                updatedAt: updated.updatedAt,
                generating: false,
              }
            }
            return {
              ...previous,
              settings: updated.settings,
              updatedAt: updated.updatedAt,
            }
          }
        )
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to set the initial agent mode'
        toast.error('Project Assistant Error', { description: message })
        return
      }
    }

    setInput('')

    try {
      isGeneratingRef.current = true
      setIsGenerating(true)
      const attachmentHint = attachedDocuments.length
        ? `\n\nProject files explicitly referenced for this request:\n${attachedDocuments
            .map((entry) => `- ${entry.title}`)
            .join('\n')}`
        : ''
      await generateMutation.mutateAsync({
        projectId,
        documentId: targetDocumentId,
        chatId: targetChatId,
        message: `${trimmed}${attachmentHint}`,
        contextDocumentId: documentId,
        selectionFrom: editorSelection?.from,
        selectionTo: editorSelection?.to,
      })
    } catch (error) {
      isGeneratingRef.current = false
      setIsGenerating(false)
      setInput(trimmed)
      const message =
        error instanceof Error ? error.message : 'Failed to start AI response generation'
      toast.error('AI Chat Error', { description: message })
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  const streamingAssistantMessageId = useMemo(() => {
    if (!isGenerating) return null
    return getTrailingAssistantMessage(messages)?.id ?? null
  }, [isGenerating, messages])

  return (
    <div
      data-chat-panel="true"
      className={cn('relative flex h-full min-w-0 flex-col overflow-hidden', className)}
    >
      <div className="border-b bg-background/70 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary/50 text-secondary-foreground">
              <PenTool className="size-3.5" />
            </div>
            <h3 className="truncate text-sm font-semibold tracking-tight text-foreground">
              {activeThreadQuery.data?.title ?? activeThread?.title ?? 'New conversation'}
            </h3>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <label
              className="mr-1 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] font-medium text-muted-foreground"
              title={
                editingEnabled
                  ? 'Agent can read and directly edit project documents'
                  : 'Ask can inspect the project without editing documents'
              }
            >
              <PenTool className="size-3" />
              <span className="hidden sm:inline">Agent</span>
              <Switch
                data-chat-editing-toggle="true"
                size="sm"
                checked={editingEnabled}
                aria-label={editingEnabled ? 'Agent mode enabled' : 'Ask mode enabled'}
                disabled={!queryEnabled || isGenerating || updateSettingsMutation.isPending}
                onCheckedChange={(checked) => {
                  if (!projectId || !operationDocumentId) return

                  if (hasActiveThreadId && activeThreadId) {
                    updateSettingsMutation.mutate(
                      {
                        projectId,
                        documentId: operationDocumentId,
                        chatId: activeThreadId,
                        editingEnabled: checked,
                      },
                      {
                        onSuccess: (updated) => {
                          utils.chat.getById.setData(
                            { projectId, documentId: operationDocumentId, chatId: activeThreadId },
                            (previous) =>
                              previous
                                ? {
                                    ...previous,
                                    settings: updated.settings,
                                    updatedAt: updated.updatedAt,
                                  }
                                : previous
                          )
                        },
                        onError: (error) => {
                          toast.error('Failed to update chat settings', {
                            description: error.message,
                          })
                        },
                      }
                    )
                    return
                  }

                  setDraftEditingEnabled(checked)
                }}
              />
            </label>
            <Button
              variant="ghost"
              size="icon-sm"
              data-chat-new-thread="true"
              disabled={!queryEnabled || isGenerating}
              onClick={() => {
                resetLocalChatState({ clearInput: true, clearThread: true })
              }}
            >
              <Plus className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              data-chat-history-toggle="true"
              disabled={!queryEnabled || threads.length === 0}
              onClick={() => setIsThreadBrowserOpen((value) => !value)}
            >
              <History className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              data-chat-delete-thread="true"
              disabled={
                !queryEnabled || !activeThreadId || deleteThreadMutation.isPending || isGenerating
              }
              onClick={() => {
                if (activeThreadId) void deleteThread(activeThreadId)
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>

        {isThreadBrowserOpen && threads.length > 0 && (
          <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-border/70 bg-card/90 p-1.5">
            <label className="mb-1.5 flex items-center gap-2 rounded-lg border border-border/50 bg-background/70 px-2 text-muted-foreground">
              <Search className="size-3.5" />
              <input
                value={historyFilter}
                onChange={(event) => setHistoryFilter(event.target.value)}
                placeholder="Search conversations"
                className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
              />
            </label>
            {visibleThreads.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                active={thread.id === activeThreadId}
                onSelect={() => {
                  setActiveThreadId(thread.id)
                  resetLocalChatState()
                }}
                onDelete={() => {
                  void deleteThread(thread.id)
                }}
                disabled={isGenerating && thread.id === activeThreadId}
              />
            ))}
            {visibleThreads.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                No matching conversations.
              </p>
            )}
          </div>
        )}

        <p className="mt-1 text-xs text-muted-foreground">
          {editingEnabled
            ? 'Agent mode — reads and edits across this project.'
            : 'Ask mode — research the project without changing documents.'}
        </p>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-w-0 space-y-4 overflow-x-hidden overflow-y-auto px-3 py-4"
      >
        {messages.length === 0 && <EmptyChatState onSuggestionClick={setInput} />}

        {messages.map((message, messageIndex) => (
          <ChatBubble
            key={message.id}
            message={message}
            isActivePathLeaf={messageIndex === messages.length - 1}
            branchMeta={
              tree
                ? getBranchMeta(tree, message.id)
                : { index: 0, count: 1, siblingIds: [message.id] }
            }
            isStreaming={streamingAssistantMessageId === message.id}
            isEditing={editingMessageId === message.id}
            disabled={
              isGenerating ||
              updateMessageMutation.isPending ||
              editMessageAndGenerateMutation.isPending ||
              deleteMessagesMutation.isPending ||
              selectBranchMutation.isPending ||
              regenerateMutation.isPending
            }
            onStartEdit={setEditingMessageId}
            onCancelEdit={() => setEditingMessageId(null)}
            onSaveEditOnly={(messageId, text) => {
              void handleSaveMessageOnly(messageId, text)
            }}
            onSaveEditAndGenerate={(messageId, text) => {
              void handleSaveMessageAndGenerate(messageId, text)
            }}
            onDelete={(messageId, mode) => {
              void handleDeleteMessages(messageId, mode)
            }}
            onSelectBranch={(nodeId) => {
              void handleSelectBranch(nodeId)
            }}
            onRegenerate={(messageId) => {
              void handleRegenerate(messageId)
            }}
          />
        ))}
      </div>

      <div className="border-t border-border/50 bg-background/50 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {documentId && (
            <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-accent/35 bg-accent/10 px-2 py-1 text-[10px] font-medium text-foreground/75">
              <PenTool className="size-3 text-accent-foreground" />
              Active document
              {editorSelection && <span className="text-muted-foreground">· selection</span>}
            </span>
          )}
          {attachedDocuments.map((document) => (
            <span
              key={document.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/70 bg-card px-2 py-1 text-[10px] text-foreground/80"
            >
              <span className="max-w-36 truncate">@{document.title}</span>
              <button
                type="button"
                aria-label={`Remove ${document.title} from context`}
                className="rounded-full text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setAttachedDocumentIds((current) => current.filter((id) => id !== document.id))
                }
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 rounded-full px-2 text-[10px]"
            onClick={() => setAttachmentPickerOpen((open) => !open)}
            disabled={!projectId || isGenerating}
          >
            <AtSign className="size-3" />
            Add context
          </Button>
        </div>
        {attachmentPickerOpen && (
          <div className="mb-2 max-h-36 overflow-y-auto rounded-xl border border-border/70 bg-card/95 p-1.5 shadow-sm">
            {(documentsQuery.data ?? []).map((document) => {
              const attached = attachedDocumentIds.includes(document.id)
              return (
                <button
                  key={document.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-muted/60"
                  onClick={() => {
                    setAttachedDocumentIds((current) =>
                      attached
                        ? current.filter((id) => id !== document.id)
                        : [...current, document.id]
                    )
                  }}
                >
                  <span className="truncate">{document.title}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {attached ? 'Attached' : 'Attach'}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <div className="relative rounded-xl border bg-background shadow-sm focus-within:ring-1 focus-within:ring-primary/50">
          <Textarea
            data-chat-input="true"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              editingEnabled ? 'Give the project assistant a task…' : 'Ask about this project…'
            }
            disabled={!queryEnabled || isGenerating || generateMutation.isPending}
            className="min-h-12 max-h-36 resize-none border-0 bg-transparent px-3.5 py-3 pr-12 text-sm leading-relaxed shadow-none focus-visible:ring-0"
          />
          <div className="absolute bottom-2 right-2 flex items-center">
            {isGenerating ? (
              <Button
                variant="ghost"
                size="icon-sm"
                data-chat-stop="true"
                onClick={() => {
                  void handleStop()
                }}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                disabled={cancelGenerationMutation.isPending}
              >
                <StopCircle className="size-4.5" />
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="icon-sm"
                data-chat-send="true"
                onClick={() => {
                  void handleSend()
                }}
                disabled={!canSend}
                className="size-8 rounded-lg"
              >
                <CornerDownLeft className="size-4" />
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-muted-foreground/60">
          {canContinue && !input.trim()
            ? 'Enter to generate a reply without a new message'
            : 'Enter to send, Shift+Enter for newline'}
        </p>
      </div>
    </div>
  )
}
