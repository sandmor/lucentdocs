import { memo, useState } from 'react'
import type { UIMessage } from 'ai'
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Eye,
  MessageSquareQuote,
  MoreHorizontal,
  Pencil,
  PenTool,
  RefreshCw,
  Search,
  Trash2,
  User,
} from 'lucide-react'
import { Streamdown } from 'streamdown'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { extractMessageText, extractToolParts } from './message-utils'
import type { BranchMeta } from './tree'
import type { ChatThreadSummary } from './types'

export type DeleteChatMessageMode = 'only' | 'from_here' | 'branch'

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
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        data-chat-thread-select={thread.id}
        onClick={onSelect}
      >
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

function ChatMarkdown({ children }: { children: string }) {
  return (
    <div className="chat-markdown streamdown text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none min-w-0">
      <Streamdown>{children}</Streamdown>
    </div>
  )
}

interface ChatBubbleProps {
  message: UIMessage
  branchMeta: BranchMeta
  isActivePathLeaf: boolean
  isStreaming: boolean
  isEditing: boolean
  disabled: boolean
  onStartEdit: (messageId: string) => void
  onCancelEdit: () => void
  onSaveEditOnly: (messageId: string, text: string) => void
  onSaveEditAndGenerate: (messageId: string, text: string) => void
  onDelete: (messageId: string, mode: DeleteChatMessageMode) => void
  onSelectBranch: (messageId: string) => void
  onRegenerate: (messageId: string) => void
}

function ChatBubbleImpl({
  message,
  branchMeta,
  isActivePathLeaf,
  isStreaming,
  isEditing,
  disabled,
  onStartEdit,
  onCancelEdit,
  onSaveEditOnly,
  onSaveEditAndGenerate,
  onDelete,
  onSelectBranch,
  onRegenerate,
}: ChatBubbleProps) {
  const isUser = message.role === 'user'
  const text = extractMessageText(message)
  const toolParts = extractToolParts(message)
  const [draft, setDraft] = useState(text)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const canEdit = toolParts.length === 0 && Boolean(text)
  const generateSaveLabel = isUser && isActivePathLeaf ? 'Send' : 'Regenerate'

  return (
    <>
      <div
        data-chat-message-id={message.id}
        className={cn(
          'group/message animate-in fade-in-0 slide-in-from-bottom-1 flex w-full min-w-0 gap-3 py-3 duration-200',
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
          <div className="flex min-h-7 items-center gap-2">
            <span className="text-xs font-medium text-foreground/80">
              {isUser ? 'Author' : 'Editorial Assistant'}
            </span>

            {!isEditing && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="ml-auto opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100"
                      aria-label="Message actions"
                      data-chat-message-actions={message.id}
                      disabled={disabled}
                    />
                  }
                >
                  <MoreHorizontal className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto min-w-36">
                  {canEdit && (
                    <DropdownMenuItem
                      data-chat-message-edit={message.id}
                      onClick={() => {
                        setDraft(text)
                        onStartEdit(message.id)
                      }}
                    >
                      <Pencil />
                      Edit
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    data-chat-message-regenerate={message.id}
                    onClick={() => onRegenerate(message.id)}
                  >
                    <RefreshCw />
                    Regenerate
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    data-chat-message-delete={message.id}
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {isEditing ? (
            <div className="space-y-2">
              <Textarea
                autoFocus
                data-chat-message-edit-input={message.id}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    onCancelEdit()
                  }
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    if (draft.trim()) onSaveEditAndGenerate(message.id, draft)
                  }
                }}
                className="min-h-20 max-h-48 resize-y text-sm"
              />
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onCancelEdit}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-chat-message-edit-save={message.id}
                  disabled={!draft.trim() || disabled}
                  onClick={() => onSaveEditOnly(message.id, draft)}
                >
                  Save only
                </Button>
                <Button
                  type="button"
                  size="sm"
                  data-chat-message-edit-generate={message.id}
                  disabled={!draft.trim() || disabled}
                  onClick={() => onSaveEditAndGenerate(message.id, draft)}
                >
                  {generateSaveLabel}
                </Button>
              </div>
            </div>
          ) : (
            <div
              className={cn(
                'min-w-0 text-sm leading-relaxed text-foreground/90',
                isUser ? 'font-medium wrap-break-word' : ''
              )}
            >
              {text ? (
                isUser ? (
                  <p className="wrap-break-word whitespace-pre-wrap">{text}</p>
                ) : (
                  <ChatMarkdown>{text}</ChatMarkdown>
                )
              ) : (
                isStreaming && <TypingIndicator />
              )}

              {isStreaming && text && <TypingIndicator compact />}
            </div>
          )}

          {toolParts.length > 0 && (
            <div className="mt-4 flex flex-col gap-1.5">
              {toolParts.map((part, index) => (
                <ToolTraceCard key={`${message.id}-tool-${index}`} part={part} />
              ))}
            </div>
          )}

          {branchMeta.count > 1 && !isEditing && (
            <div
              className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground"
              data-chat-branch-pager={message.id}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                data-chat-branch-prev={message.id}
                disabled={disabled || branchMeta.index <= 0}
                onClick={() => {
                  const previousId = branchMeta.siblingIds[branchMeta.index - 1]
                  if (previousId) onSelectBranch(previousId)
                }}
                aria-label="Previous branch"
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <span data-chat-branch-label={message.id}>
                {branchMeta.index + 1} / {branchMeta.count}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                data-chat-branch-next={message.id}
                disabled={disabled || branchMeta.index >= branchMeta.count - 1}
                onClick={() => {
                  const nextId = branchMeta.siblingIds[branchMeta.index + 1]
                  if (nextId) onSelectBranch(nextId)
                }}
                aria-label="Next branch"
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete message?</AlertDialogTitle>
            <AlertDialogDescription>
              Choose how this message should be removed from the conversation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:flex-col">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-chat-message-delete-only={message.id}
              onClick={() => onDelete(message.id, 'only')}
            >
              Delete this message
            </AlertDialogAction>
            {branchMeta.count > 1 && (
              <AlertDialogAction
                data-chat-message-delete-branch={message.id}
                onClick={() => onDelete(message.id, 'branch')}
              >
                Delete this regeneration
              </AlertDialogAction>
            )}
            <AlertDialogAction
              data-chat-message-delete-from={message.id}
              onClick={() => onDelete(message.id, 'from_here')}
            >
              Delete this and everything after
            </AlertDialogAction>
          </AlertDialogFooter>
          <div className="space-y-2 px-1 pb-1 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Delete this message</span> removes the
              turn and any alternate replies beneath it, while keeping the active continuation.
            </p>
            {branchMeta.count > 1 && (
              <p>
                <span className="font-medium text-foreground">Delete this regeneration</span>{' '}
                removes only this alternative and its branch. Other regenerations stay available.
              </p>
            )}
            <p>
              <span className="font-medium text-foreground">Delete this and everything after</span>{' '}
              permanently removes this message and all following turns, including branches.
            </p>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export const ChatBubble = memo(
  ChatBubbleImpl,
  (previous, next) =>
    previous.isStreaming === next.isStreaming &&
    previous.isEditing === next.isEditing &&
    previous.disabled === next.disabled &&
    previous.message === next.message &&
    previous.onStartEdit === next.onStartEdit &&
    previous.onCancelEdit === next.onCancelEdit &&
    previous.onSaveEditOnly === next.onSaveEditOnly &&
    previous.onSaveEditAndGenerate === next.onSaveEditAndGenerate &&
    previous.isActivePathLeaf === next.isActivePathLeaf &&
    previous.onDelete === next.onDelete &&
    previous.branchMeta === next.branchMeta
)

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
  const isEditTool = toolName === 'edit'

  return (
    <details className="group max-w-full min-w-0 overflow-hidden rounded-lg border border-border/40 bg-background/50 transition-colors hover:bg-muted/20">
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2.5 px-3 py-2 text-xs font-medium text-muted-foreground outline-none">
        {isPending ? (
          isEditTool ? (
            <PenTool className="size-3.5 animate-pulse text-primary/60" />
          ) : (
            <Search className="size-3.5 animate-pulse text-primary/60" />
          )
        ) : isEditTool ? (
          <PenTool className="size-3.5 text-muted-foreground/60" />
        ) : (
          <Eye className="size-3.5 text-muted-foreground/60" />
        )}

        <span className="truncate text-foreground/70 group-hover:text-foreground transition-colors">
          {isEditTool ? 'edit file' : toolName.replace(/-/g, ' ')}
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

      <div className="min-w-0 overflow-hidden border-t border-border/40 bg-muted/10 p-3">
        <pre className="max-h-40 max-w-full overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-muted-foreground/80 scrollbar-thin">
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
              <span className="min-w-0 leading-snug wrap-break-word">{suggestion}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
