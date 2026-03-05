import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type UIMessage } from 'ai'
import { StopCircle, Trash2, Plus, History, CornerDownLeft, PenTool } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { asUIMessageArray, getTrailingAssistantMessage } from './message-utils'
import type { ChatThreadSummary } from './types'
import { ChatBubble, EmptyChatState, ThreadRow } from './ui'
import { useChatStreamPump } from './use-stream-pump'

interface ChatPanelProps {
  editorSelection: { from: number; to: number } | null
  projectId?: string
  documentId: string | null
  className?: string
}

export function ChatPanel({ editorSelection, projectId, documentId, className }: ChatPanelProps) {
  const utils = trpc.useUtils()
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isThreadBrowserOpen, setIsThreadBrowserOpen] = useState(false)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldStickToBottomRef = useRef(true)
  const activeThreadIdRef = useRef<string | null>(null)
  const messagesRef = useRef<UIMessage[]>([])
  const isGeneratingRef = useRef(false)
  const lastGenerationErrorRef = useRef<string | null>(null)

  const queryEnabled = Boolean(projectId && documentId)
  const documentKey = projectId && documentId ? `${projectId}:${documentId}` : null

  const threadsQuery = trpc.chat.listByDocument.useQuery(
    { projectId: projectId ?? '', documentId: documentId ?? '' },
    { enabled: queryEnabled }
  )

  const threads = useMemo(() => threadsQuery.data?.threads ?? [], [threadsQuery.data?.threads])
  const hasActiveThreadId = Boolean(
    activeThreadId && threads.some((thread) => thread.id === activeThreadId)
  )

  const activeThreadQuery = trpc.chat.getById.useQuery(
    {
      projectId: projectId ?? '',
      documentId: documentId ?? '',
      chatId: activeThreadId ?? '',
    },
    {
      enabled: queryEnabled && hasActiveThreadId,
    }
  )

  const createThreadMutation = trpc.chat.create.useMutation()
  const deleteThreadMutation = trpc.chat.deleteById.useMutation()
  const generateMutation = trpc.chat.generateById.useMutation()
  const cancelGenerationMutation = trpc.chat.cancelGenerationById.useMutation()

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

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [threads, activeThreadId]
  )

  const resetLocalChatState = useCallback(
    (
      options: {
        clearInput?: boolean
        clearThread?: boolean
        closeThreadBrowser?: boolean
      } = {}
    ) => {
      setMessages([])
      setIsGenerating(false)
      messagesRef.current = []
      isGeneratingRef.current = false
      lastGenerationErrorRef.current = null
      if (options.clearInput) {
        setInput('')
      }
      if (options.clearThread) {
        setActiveThreadId(null)
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
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return
      resetLocalChatState({
        clearInput: true,
        clearThread: true,
        closeThreadBrowser: true,
      })
    })

    return () => {
      cancelled = true
    }
  }, [documentKey, resetLocalChatState])

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
      const nextGenerating = Boolean(activeThreadQuery.data.generating)
      messagesRef.current = nextMessages
      isGeneratingRef.current = nextGenerating
      setMessages(nextMessages)
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
      documentId: documentId ?? '',
      chatId: activeThreadId ?? '',
    },
    {
      enabled: queryEnabled && Boolean(activeThreadId),
      onData: (event) => {
        if (!projectId || !documentId || !activeThreadId) return
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

        if (event.deleted || !event.thread) {
          resetLocalChatState({ clearThread: true })
          utils.chat.listByDocument.setData({ projectId, documentId }, (previous) => {
            const current = previous?.threads ?? []
            return { threads: current.filter((thread) => thread.id !== activeThreadId) }
          })
          void utils.chat.getById.invalidate({
            projectId,
            documentId,
            chatId: activeThreadId,
          })
          return
        }

        const nextMessages = asUIMessageArray(event.thread.messages)
        messagesRef.current = nextMessages
        isGeneratingRef.current = event.generating
        setMessages(nextMessages)
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
          title: event.thread.title,
          createdAt: event.thread.createdAt,
          updatedAt: event.thread.updatedAt,
          messageCount: nextMessages.length,
        }

        utils.chat.getById.setData(
          { projectId, documentId, chatId: event.thread.id },
          {
            id: event.thread.id,
            title: event.thread.title,
            messages: nextMessages,
            createdAt: event.thread.createdAt,
            updatedAt: event.thread.updatedAt,
            generating: event.generating,
          }
        )

        utils.chat.listByDocument.setData({ projectId, documentId }, (previous) => {
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
      const created = await createThreadMutation.mutateAsync({ projectId, documentId })
      utils.chat.listByDocument.setData({ projectId, documentId }, (previous) => {
        const existing = previous?.threads ?? []
        return {
          threads: [
            {
              id: created.id,
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
  }, [createThreadMutation, documentId, projectId, utils.chat.listByDocument])

  const deleteThread = useCallback(
    async (threadId: string) => {
      if (!projectId || !documentId) return
      if (isGenerating && threadId === activeThreadId) return

      try {
        await deleteThreadMutation.mutateAsync({ projectId, documentId, chatId: threadId })
        utils.chat.listByDocument.setData({ projectId, documentId }, (previous) => {
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
      documentId,
      isGenerating,
      projectId,
      resetLocalChatState,
      utils.chat.listByDocument,
    ]
  )

  const handleStop = async () => {
    if (!projectId || !documentId || !activeThreadId || !isGenerating) return

    try {
      await cancelGenerationMutation.mutateAsync({
        projectId,
        documentId,
        chatId: activeThreadId,
        generationId: streamGenerationIdRef.current ?? undefined,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop generation'
      toast.error('AI Chat Error', { description: message })
    }
  }

  const handleSend = async () => {
    const trimmed = input.trim()
    if (!trimmed || !projectId || !documentId || isGenerating) return

    let targetChatId = activeThreadId
    if (!targetChatId) {
      targetChatId = await createThread()
      if (!targetChatId) return
      setActiveThreadId(targetChatId)
      resetLocalChatState()
    }

    setInput('')

    try {
      await generateMutation.mutateAsync({
        projectId,
        documentId,
        chatId: targetChatId,
        message: trimmed,
        selectionFrom: editorSelection?.from,
        selectionTo: editorSelection?.to,
      })
    } catch (error) {
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
    <div data-chat-panel="true" className={cn('relative flex h-full flex-col', className)}>
      <div className="border-b bg-background/70 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary/50 text-secondary-foreground">
              <PenTool className="size-3.5" />
            </div>
            <h3 className="truncate text-sm font-semibold tracking-tight text-foreground">
              {activeThreadQuery.data?.title ?? activeThread?.title ?? 'New Chat'}
            </h3>
          </div>
          <div className="flex items-center gap-0.5">
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
          <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-border/70 bg-card/90 p-1.5">
            {threads.map((thread) => (
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
          </div>
        )}

        <p className="mt-1 text-xs text-muted-foreground">
          Ask about this project and inspect files with tools.
        </p>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {messages.length === 0 && <EmptyChatState onSuggestionClick={setInput} />}

        {messages.map((message) => (
          <ChatBubble
            key={message.id}
            message={message}
            isStreaming={streamingAssistantMessageId === message.id}
          />
        ))}
      </div>

      <div className="border-t border-border/50 bg-background/50 p-4">
        <div className="relative rounded-xl border bg-background shadow-sm focus-within:ring-1 focus-within:ring-primary/50">
          <Textarea
            data-chat-input="true"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question or bounce an idea..."
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
                disabled={!queryEnabled || !input.trim() || generateMutation.isPending}
                className="size-8 rounded-lg"
              >
                <CornerDownLeft className="size-4" />
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-muted-foreground/60">
          Enter to send, Shift+Enter for newline
        </p>
      </div>
    </div>
  )
}
