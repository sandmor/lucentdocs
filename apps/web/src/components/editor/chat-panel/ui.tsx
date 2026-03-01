import type { UIMessage } from 'ai'
import { BookOpen, Eye, MessageSquareQuote, Search, Trash2, User } from 'lucide-react'
import { Streamdown } from 'streamdown'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { extractMessageText, extractToolParts } from './message-utils'
import type { ChatThreadSummary } from '../chat/types'

export function ThreadRow({
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

export function ChatBubble({ message, isStreaming }: { message: UIMessage; isStreaming: boolean }) {
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

export const EMPTY_CHAT_SUGGESTIONS = [
  'Analyze the pacing of this section in relation to the rest of the story',
  'Suggest alternative phrasings for the highlighted text',
  'Punch up the dialogue here',
] as const

export function EmptyChatState({
  onSuggestionClick,
}: {
  onSuggestionClick: (value: string) => void
}) {
  return (
    <div className="flex h-full flex-col justify-end pb-4">
      <div className="space-y-5">
        <div>
          <h4 className="font-medium text-foreground">Ready to review the draft?</h4>
          <p className="text-sm text-muted-foreground">
            Context automatically includes your active chapter and any highlighted text.
          </p>
        </div>

        <div className="grid gap-2">
          {EMPTY_CHAT_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-card/50 px-3.5 py-2.5 text-left text-sm text-muted-foreground transition-all hover:bg-muted/50 hover:text-foreground"
              onClick={() => onSuggestionClick(suggestion)}
            >
              <MessageSquareQuote className="size-4 text-muted-foreground/70" />
              <span className="leading-snug">{suggestion}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
