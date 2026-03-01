import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'
import {
  User,
  StopCircle,
  Trash2,
  Plus,
  History,
  CornerDownLeft,
  PenTool,
  BookOpen,
  Search,
  Eye,
  MessageSquareQuote,
} from 'lucide-react'
import { toast } from 'sonner'
import { Streamdown } from 'streamdown'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import {
  extractMessageTextFromParts,
  extractToolPartsFromParts,
  getMessageParts,
} from './ai-message-parts'

interface ChatPanelProps {
  editorSelection: { from: number; to: number } | null
  projectId?: string
  documentId: string | null
  className?: string
}

interface ChatThreadSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export function ChatPanel({ editorSelection, projectId, documentId, className }: ChatPanelProps) {
  const utils = trpc.useUtils()
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isThreadBrowserOpen, setIsThreadBrowserOpen] = useState(false)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeThreadIdRef = useRef<string | null>(null)
  const streamAssistantRef = useRef<UIMessage | null>(null)
  const streamGenerationIdRef = useRef<string | null>(null)
  const streamChunkControllerRef = useRef<ReadableStreamDefaultController<UIMessageChunk> | null>(
    null
  )

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

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [threads, activeThreadId]
  )

  const stopStreamChunkPump = useCallback(() => {
    if (streamChunkControllerRef.current) {
      try {
        streamChunkControllerRef.current.close()
      } catch {
        // ignore double-close races
      }
    }
    streamChunkControllerRef.current = null
    streamAssistantRef.current = null
    streamGenerationIdRef.current = null
  }, [])

  const startStreamChunkPump = useCallback(
    (generationId: string, seedAssistant: UIMessage | null, chatId: string) => {
      stopStreamChunkPump()
      streamAssistantRef.current = seedAssistant
      streamGenerationIdRef.current = generationId

      const chunkStream = new ReadableStream<UIMessageChunk>({
        start(controller) {
          streamChunkControllerRef.current = controller
        },
      })

      void (async () => {
        let latestAssistant = seedAssistant
        for await (const nextMessage of readUIMessageStream<UIMessage>({
          message: latestAssistant ?? undefined,
          stream: chunkStream,
          terminateOnError: false,
          onError: (error) => {
            console.warn('Failed to read chat UI stream chunk', { error })
          },
        })) {
          if (activeThreadIdRef.current !== chatId) {
            continue
          }
          latestAssistant = nextMessage
          streamAssistantRef.current = nextMessage
          setIsGenerating(true)
          setMessages((previous) => upsertAssistantMessage(previous, nextMessage))
        }
      })().catch((error) => {
        console.warn('Chat stream chunk pump failed', { error })
      })
    },
    [stopStreamChunkPump]
  )

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId
  }, [activeThreadId])

  useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return
      setMessages([])
      setInput('')
      setIsGenerating(false)
      setIsThreadBrowserOpen(false)
      setActiveThreadId(null)
      stopStreamChunkPump()
    })

    return () => {
      cancelled = true
    }
  }, [documentKey, stopStreamChunkPump])

  useEffect(() => {
    if (!queryEnabled) return

    let cancelled = false

    if (threads.length === 0 && activeThreadId !== null) {
      queueMicrotask(() => {
        if (cancelled) return
        setActiveThreadId(null)
        setMessages([])
        setInput('')
        setIsGenerating(false)
        stopStreamChunkPump()
      })
    } else if (activeThreadId && !threads.some((thread) => thread.id === activeThreadId)) {
      queueMicrotask(() => {
        if (cancelled) return
        setActiveThreadId(null)
        setMessages([])
        setIsGenerating(false)
        stopStreamChunkPump()
      })
    }

    return () => {
      cancelled = true
    }
  }, [activeThreadId, queryEnabled, stopStreamChunkPump, threads])

  useEffect(() => {
    if (!activeThreadId || !activeThreadQuery.data) return

    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return
      setMessages(asUIMessageArray(activeThreadQuery.data.messages))
      setIsGenerating(Boolean(activeThreadQuery.data.generating))
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
            startStreamChunkPump(event.generationId, streamAssistantRef.current, event.chatId)
          }

          try {
            streamChunkControllerRef.current?.enqueue(event.chunk)
          } catch (error) {
            console.warn('Failed to enqueue chat stream chunk', { error })
          }
          return
        }

        if (event.deleted || !event.thread) {
          setIsGenerating(false)
          setMessages([])
          setActiveThreadId(null)
          stopStreamChunkPump()
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
        setMessages(nextMessages)
        setIsGenerating(event.generating)
        const latestAssistant =
          [...nextMessages].reverse().find((message) => message.role === 'assistant') ?? null
        streamAssistantRef.current = latestAssistant

        if (event.generating && event.generationId) {
          if (streamGenerationIdRef.current !== event.generationId) {
            startStreamChunkPump(event.generationId, latestAssistant, event.chatId)
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
      },
      onError: (error) => {
        toast.error('Chat subscription error', { description: error.message })
      },
    }
  )

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
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
          setMessages([])
          setInput('')
          setIsGenerating(false)
          setActiveThreadId(null)
          stopStreamChunkPump()
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
      stopStreamChunkPump,
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
      setMessages([])
      setIsGenerating(false)
      stopStreamChunkPump()
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

  return (
    <div className={cn('relative flex h-full flex-col', className)}>
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
              disabled={!queryEnabled || isGenerating}
              onClick={() => {
                setActiveThreadId(null)
                setMessages([])
                setInput('')
                setIsGenerating(false)
                stopStreamChunkPump()
              }}
            >
              <Plus className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!queryEnabled || threads.length === 0}
              onClick={() => setIsThreadBrowserOpen((value) => !value)}
            >
              <History className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
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
                  setMessages([])
                  setIsGenerating(false)
                  stopStreamChunkPump()
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
        {messages.length === 0 && (
          <div className="flex h-full flex-col justify-end pb-4">
            <div className="space-y-5">
              <div>
                <h4 className="font-medium text-foreground">Ready to review the draft?</h4>
                <p className="text-sm text-muted-foreground">
                  Context automatically includes your active chapter and any highlighted text.
                </p>
              </div>

              <div className="grid gap-2">
                {[
                  'Analyze the pacing of this section in relation to the rest of the story',
                  'Suggest alternative phrasings for the highlighted text',
                  'Punch up the dialogue here',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-card/50 px-3.5 py-2.5 text-left text-sm text-muted-foreground transition-all hover:bg-muted/50 hover:text-foreground"
                    onClick={() => setInput(suggestion)}
                  >
                    <MessageSquareQuote className="size-4 text-muted-foreground/70" />
                    <span className="leading-snug">{suggestion}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <ChatBubble
            key={message.id}
            message={message}
            isStreaming={
              isGenerating && index === messages.length - 1 && message.role === 'assistant'
            }
          />
        ))}
      </div>

      <div className="border-t border-border/50 bg-background/50 p-4">
        <div className="relative rounded-xl border bg-background shadow-sm focus-within:ring-1 focus-within:ring-primary/50">
          <Textarea
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
                onClick={() => {
                  void handleStop()
                }}
                className="text-destructive"
                disabled={cancelGenerationMutation.isPending}
              >
                <StopCircle className="size-4.5" />
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="icon-sm"
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

function ThreadRow({
  thread,
  active,
  onSelect,
  onDelete,
  disabled,
}: {
  thread: ChatThreadSummary
  active: boolean
  onSelect: () => void
  onDelete: () => void
  disabled: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg px-2.5 py-2',
        active ? 'bg-accent/80' : 'hover:bg-muted/70'
      )}
    >
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onSelect}>
        <p className="line-clamp-1 text-xs font-medium">{thread.title}</p>
        <p className="text-[10px] text-muted-foreground">
          {new Date(thread.updatedAt).toLocaleString()} · {thread.messageCount} messages
        </p>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onDelete()
        }}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}

function ChatBubble({ message, isStreaming }: { message: UIMessage; isStreaming: boolean }) {
  const isUser = message.role === 'user'
  const text = extractMessageText(message)
  const toolParts = extractToolParts(message)

  return (
    <div
      className={cn(
        'animate-in fade-in-0 slide-in-from-bottom-1 flex w-full gap-3 py-3 duration-200',
        isUser ? 'items-start' : 'items-start rounded-lg bg-muted/30 px-3'
      )}
    >
      <div
        className={cn(
          'mt-1 flex size-6 shrink-0 items-center justify-center rounded-sm',
          isUser
            ? 'bg-background border border-border/50 text-muted-foreground'
            : 'bg-primary/10 text-primary'
        )}
      >
        {isUser ? <User className="size-3.5" /> : <BookOpen className="size-3.5" />}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground/80">
            {isUser ? 'Author' : 'Editorial Assistant'}
          </span>
        </div>

        <div
          className={cn('text-sm leading-relaxed text-foreground/90', isUser ? 'font-medium' : '')}
        >
          {text ? (
            <div className="streamdown text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">
              <Streamdown>{text}</Streamdown>
            </div>
          ) : (
            isStreaming && <TypingIndicator />
          )}

          {isStreaming && text && <TypingIndicator compact />}
        </div>

        {toolParts.length > 0 && (
          <div className="mt-4 flex flex-col gap-1.5">
            {toolParts.map((part, index) => (
              <ToolTraceCard key={`${message.id}-tool-${index}`} part={part} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TypingIndicator({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <span className="ml-1 inline-flex size-3.5 items-center justify-center align-middle">
        <span className="size-1.5 animate-pulse rounded-full bg-primary/55" />
      </span>
    )
  }

  return (
    <div className="flex items-center gap-1.5 py-1" aria-label="Assistant is typing">
      <div className="h-2 w-2 animate-pulse rounded-full bg-primary/40" />
      <div className="h-2 w-2 animate-pulse rounded-full bg-primary/40 delay-75" />
      <div className="h-2 w-2 animate-pulse rounded-full bg-primary/40 delay-150" />
    </div>
  )
}

function ToolTraceCard({ part }: { part: Record<string, unknown> }) {
  const partType = typeof part.type === 'string' ? part.type : 'tool'
  const toolName =
    partType === 'dynamic-tool'
      ? typeof part.toolName === 'string'
        ? part.toolName
        : 'dynamic-tool'
      : partType.replace(/^tool-/, '')
  const state = typeof part.state === 'string' ? part.state : 'unknown'

  const isPending = state === 'call' || state === 'pending'
  const statusText = isPending ? 'Reviewing...' : 'Reviewed'

  return (
    <details className="group max-w-full min-w-0 rounded-lg border border-border/40 bg-background/50 transition-colors hover:bg-muted/20">
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2.5 px-3 py-2 text-xs font-medium text-muted-foreground outline-none">
        {isPending ? (
          <Search className="size-3.5 animate-pulse text-primary/60" />
        ) : (
          <Eye className="size-3.5 text-muted-foreground/60" />
        )}

        <span className="truncate text-foreground/70 group-hover:text-foreground transition-colors">
          {toolName.replace(/-/g, ' ')}
        </span>

        <span
          className={cn(
            'ml-auto shrink-0 text-[10px] tracking-wide',
            isPending ? 'text-primary/70 animate-pulse' : 'text-muted-foreground/50'
          )}
        >
          {statusText}
        </span>
      </summary>

      <div className="border-t border-border/40 bg-muted/10 p-3">
        <pre className="max-h-40 max-w-full overflow-auto whitespace-pre-wrap wrap-break-word font-mono text-[10px] leading-relaxed text-muted-foreground/80 scrollbar-thin">
          {JSON.stringify(part, null, 2)}
        </pre>
      </div>
    </details>
  )
}

function asUIMessageArray(value: unknown): UIMessage[] {
  return Array.isArray(value) ? (value as UIMessage[]) : []
}

function upsertAssistantMessage(messages: UIMessage[], assistantMessage: UIMessage): UIMessage[] {
  if (messages.length === 0) {
    return [assistantMessage]
  }

  const existingIndex = messages.findIndex((message) => message.id === assistantMessage.id)
  if (existingIndex >= 0) {
    return messages.map((message, index) => (index === existingIndex ? assistantMessage : message))
  }

  const last = messages[messages.length - 1]
  if (last?.role === 'assistant') {
    return [...messages.slice(0, -1), assistantMessage]
  }

  return [...messages, assistantMessage]
}

function extractMessageText(message: UIMessage): string {
  return extractMessageTextFromParts(getMessageParts(message))
}

function extractToolParts(message: UIMessage): Record<string, unknown>[] {
  return extractToolPartsFromParts(getMessageParts(message))
}
