import { memo, useState } from 'react'
import type { UIMessage } from 'ai'
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Eye,
  FilePenLine,
  FileSearch,
  FolderSearch,
  MessageSquareQuote,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  ShieldAlert,
  Square,
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
import { getMessageParts } from '../ai/message-parts'
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
        data-chat-message-role={message.role}
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
              {isUser ? 'Author' : 'Project Assistant'}
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
            <MessageParts message={message} isStreaming={isStreaming} isUser={isUser} />
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

function MessageParts({
  message,
  isStreaming,
  isUser,
}: {
  message: UIMessage
  isStreaming: boolean
  isUser: boolean
}) {
  const parts = getMessageParts(message)
  const hasVisiblePart = parts.some((part) => {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) return false
    const type = (part as Record<string, unknown>).type
    return (
      type === 'text' ||
      type === 'dynamic-tool' ||
      (typeof type === 'string' && type.startsWith('tool-')) ||
      type === 'data-generation-status'
    )
  })

  return (
    <div
      className={cn(
        'min-w-0 space-y-2 text-sm leading-relaxed text-foreground/90',
        isUser ? 'font-medium wrap-break-word' : ''
      )}
    >
      {parts.map((part, index) => {
        if (typeof part !== 'object' || part === null || Array.isArray(part)) return null
        const record = part as Record<string, unknown>
        const key = `${message.id}-part-${index}`
        if (record.type === 'text' && typeof record.text === 'string') {
          return isUser ? (
            <p key={key} className="wrap-break-word whitespace-pre-wrap">
              {record.text}
            </p>
          ) : (
            <ChatMarkdown key={key}>{record.text}</ChatMarkdown>
          )
        }
        if (
          record.type === 'dynamic-tool' ||
          (typeof record.type === 'string' && record.type.startsWith('tool-'))
        ) {
          return <ToolTraceCard key={key} part={record} />
        }
        if (record.type === 'data-generation-status') {
          return <GenerationStatus key={key} data={record.data} />
        }
        return null
      })}
      {!hasVisiblePart && isStreaming && <TypingIndicator />}
      {isStreaming && hasVisiblePart && <TypingIndicator compact />}
    </div>
  )
}

function GenerationStatus({ data }: { data: unknown }) {
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
  const status = record.status === 'failed' ? 'failed' : 'stopped'
  const message = typeof record.message === 'string' ? record.message : null
  const Icon = status === 'failed' ? ShieldAlert : Square

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-xs',
        status === 'failed'
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-border/60 bg-muted/35 text-muted-foreground'
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 wrap-break-word">
        {status === 'failed' ? 'Response interrupted' : 'Response stopped'}
        {message ? ` — ${message}` : ''}
      </span>
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
  const input = part.input
  const output = part.output
  const errorText = typeof part.errorText === 'string' ? part.errorText : null
  const inputRecord =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const path = typeof inputRecord.path === 'string' ? inputRecord.path : null
  const status = toolStatus(state)
  const label = toolLabel(toolName, path)
  const summary = toolSummary(toolName, output, errorText)

  return (
    <details className="group/tool max-w-full min-w-0 overflow-hidden rounded-md border border-border/45 bg-background/45 transition-colors hover:bg-muted/25">
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-xs outline-none">
        <span
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-full',
            status.iconClass
          )}
        >
          <ToolIcon
            toolName={toolName}
            className={cn('size-3', status.pending && 'animate-spin')}
          />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground/80">{label}</span>
        <span className={cn('shrink-0 text-[10px] font-medium tracking-wide', status.textClass)}>
          {status.label}
        </span>
      </summary>
      <div className="min-w-0 space-y-2 border-t border-border/40 bg-muted/10 p-2.5 text-[11px]">
        {summary && <p className="wrap-break-word text-muted-foreground">{summary}</p>}
        {errorText && <p className="wrap-break-word text-destructive">{errorText}</p>}
        <ToolPayload label="Input" value={input} />
        {(output !== undefined || errorText) && (
          <ToolPayload label="Output" value={output ?? errorText} />
        )}
      </div>
    </details>
  )
}

function ToolPayload({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) return null
  return (
    <div className="min-w-0">
      <p className="mb-1 font-medium uppercase tracking-[0.12em] text-[9px] text-muted-foreground/65">
        {label}
      </p>
      <pre className="max-h-44 max-w-full overflow-auto whitespace-pre-wrap break-words rounded border border-border/35 bg-background/60 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground/85">
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

function toolStatus(state: string) {
  if (state === 'output-available')
    return {
      label: 'Done',
      pending: false,
      iconClass: 'bg-success/15 text-success',
      textClass: 'text-success',
    }
  if (state === 'output-error')
    return {
      label: 'Failed',
      pending: false,
      iconClass: 'bg-destructive/15 text-destructive',
      textClass: 'text-destructive',
    }
  if (state === 'output-denied')
    return {
      label: 'Denied',
      pending: false,
      iconClass: 'bg-destructive/15 text-destructive',
      textClass: 'text-destructive',
    }
  if (state === 'approval-requested')
    return {
      label: 'Needs approval',
      pending: false,
      iconClass: 'bg-accent/20 text-accent-foreground',
      textClass: 'text-accent-foreground',
    }
  if (state === 'approval-responded')
    return {
      label: 'Approved',
      pending: false,
      iconClass: 'bg-muted text-muted-foreground',
      textClass: 'text-muted-foreground',
    }
  return {
    label: state === 'input-streaming' ? 'Preparing' : 'Working',
    pending: true,
    iconClass: 'bg-primary/10 text-primary',
    textClass: 'text-primary',
  }
}

function ToolIcon({ toolName, className }: { toolName: string; className: string }) {
  if (toolName === 'edit' || toolName === 'write') return <FilePenLine className={className} />
  if (toolName === 'glob') return <FolderSearch className={className} />
  if (toolName === 'grep' || toolName === 'search') return <Search className={className} />
  if (toolName === 'read') return <FileSearch className={className} />
  return <Eye className={className} />
}

function toolLabel(toolName: string, path: string | null) {
  const subject = path ? ` ${path}` : ''
  if (toolName === 'edit') return `Edited${subject}`
  if (toolName === 'write') return `Wrote${subject}`
  if (toolName === 'read') return `Read${subject}`
  if (toolName === 'glob') return `Listed files${subject ? ` in${subject}` : ''}`
  if (toolName === 'grep') return `Searched text${subject ? ` in${subject}` : ''}`
  if (toolName === 'search') return 'Searched project knowledge'
  return toolName.replace(/-/g, ' ')
}

function toolSummary(toolName: string, output: unknown, errorText: string | null) {
  if (errorText) return null
  if (typeof output !== 'object' || output === null) return null
  const record = output as Record<string, unknown>
  if (toolName === 'edit' && typeof record.replacements === 'number')
    return `${record.replacements} replacement${record.replacements === 1 ? '' : 's'} applied.`
  if ((toolName === 'grep' || toolName === 'search') && typeof record.match_count === 'number')
    return `${record.match_count} match${record.match_count === 1 ? '' : 'es'} found.`
  if (toolName === 'glob' && typeof record.total_matches === 'number')
    return `${record.total_matches} file${record.total_matches === 1 ? '' : 's'} found.`
  if (toolName === 'write' && typeof record.action === 'string')
    return `${record.action[0]?.toUpperCase()}${record.action.slice(1)} successfully.`
  if (toolName === 'read' && typeof record.path === 'string')
    return `Read ${record.path}${typeof record.start_line === 'number' ? `, lines ${record.start_line}–${record.end_line}` : ''}.`
  return null
}

export const EMPTY_CHAT_SUGGESTIONS = [
  'Give me a concise map of this project and its open threads',
  'Compare the active chapter with the rest of the project for continuity issues',
  'Find where this character arc needs more support and make the edits',
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
          <h4 className="font-medium text-foreground">What should we move forward?</h4>
          <p className="text-sm text-muted-foreground">
            Your active document and highlighted text are ready as context. The assistant can work
            across the project.
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
