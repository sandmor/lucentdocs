import { useEffect, useMemo, useState } from 'react'
import { Bold, Check, Italic, Loader2, Pen, Search, X } from 'lucide-react'
import type { EditorView } from 'prosemirror-view'
import { Streamdown } from 'streamdown'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Textarea } from '@/components/ui/textarea'
import type { InlineZoneSession } from '@plotline/shared'
import type { AnimationPhase, FormatMarkName, InlineControlState } from './types'
import { selectChoice } from './utils'

interface SelectionComposeSurfaceProps {
  rootRef: { current: HTMLDivElement | null }
  className: string
  animationPhase?: AnimationPhase
  prompt: string
  markActive: {
    strong: boolean
    em: boolean
  }
  onPromptChange: (value: string) => void
  onToggleMark: (markName: FormatMarkName) => void
  onSubmit: () => void
  onInteractionChange: (interacting: boolean) => void
  showShortcutHint: boolean
}

export function SelectionComposeSurface({
  rootRef,
  className,
  animationPhase = 'idle',
  prompt,
  markActive,
  onPromptChange,
  onToggleMark,
  onSubmit,
  onInteractionChange,
  showShortcutHint,
}: SelectionComposeSurfaceProps) {
  useEffect(() => {
    return () => {
      onInteractionChange(false)
    }
  }, [onInteractionChange])

  useEffect(() => {
    if (!rootRef.current) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!event.target || !(event.target instanceof Node)) return
      if (rootRef.current?.contains(event.target)) return
      onInteractionChange(false)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [onInteractionChange, rootRef])

  return (
    <div
      ref={(node) => {
        rootRef.current = node
      }}
      className={className}
      data-testid="ai-inline-controls"
      data-state="compose"
      data-ai-phase={animationPhase}
      onPointerDownCapture={() => onInteractionChange(true)}
      onFocusCapture={() => onInteractionChange(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget
        if (
          !nextTarget ||
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          onInteractionChange(false)
        }
      }}
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Pen className="size-3" />
          Selection
        </span>
      </div>

      <div className="space-y-2 p-2">
        <Textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="Describe what should change..."
          className="min-h-18 text-sm"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              onSubmit()
            }
          }}
        />

        <div className="flex items-center gap-1 px-1">
          <Button
            variant={markActive.strong ? 'secondary' : 'ghost'}
            size="icon-xs"
            data-action="format-bold"
            title="Bold"
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onToggleMark('strong')
            }}
          >
            <Bold className="size-3" />
          </Button>
          <Button
            variant={markActive.em ? 'secondary' : 'ghost'}
            size="icon-xs"
            data-action="format-italic"
            title="Italic"
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onToggleMark('em')
            }}
          >
            <Italic className="size-3" />
          </Button>
        </div>

        <div className="flex items-center justify-between gap-2 px-1">
          {showShortcutHint ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              Send with
              <Kbd>Ctrl/Cmd</Kbd>
              <Kbd>Enter</Kbd>
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">Rewrite selection</span>
          )}

          <Button size="xs" onClick={onSubmit} disabled={!prompt.trim()}>
            <Pen className="size-3" data-icon="inline-start" />
            Rewrite
          </Button>
        </div>
      </div>
    </div>
  )
}

interface AIZoneSurfaceProps {
  rootRef: { current: HTMLDivElement | null } | null
  className: string
  animationPhase?: AnimationPhase
  view: EditorView
  zoneId?: string
  from: number
  to: number
  state: InlineControlState
  stuck: boolean
  session: InlineZoneSession | null
  onAccept: (zoneId?: string) => void
  onReject: (zoneId?: string) => void
  onContinuePrompt: (zoneId: string, prompt: string) => boolean
  onDismissChoices: (zoneId: string) => boolean
}

export function AIZoneSurface({
  rootRef,
  className,
  animationPhase = 'idle',
  view,
  zoneId,
  from,
  to,
  state,
  stuck,
  session,
  onAccept,
  onReject,
  onContinuePrompt,
  onDismissChoices,
}: AIZoneSurfaceProps) {
  const isProcessing = state === 'processing'
  const isReview = state === 'review'
  const choices = session?.choices ?? []
  const [followupPrompt, setFollowupPrompt] = useState('')

  const canSendFollowup = useMemo(
    () => Boolean(zoneId && followupPrompt.trim() && !isProcessing),
    [followupPrompt, isProcessing, zoneId]
  )

  const handleSendFollowup = () => {
    if (!zoneId) return
    const trimmed = followupPrompt.trim()
    if (!trimmed) return
    const started = onContinuePrompt(zoneId, trimmed)
    if (started) {
      setFollowupPrompt('')
    }
  }

  const handleDismissChoices = () => {
    if (!zoneId) return
    onDismissChoices(zoneId)
  }

  return (
    <div
      ref={(node) => {
        if (rootRef) {
          rootRef.current = node
        }
      }}
      className={className}
      data-testid="ai-inline-controls"
      data-state={state}
      data-zone-id={zoneId}
      data-ai-phase={animationPhase}
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Pen className="size-3" />
          Inline AI
        </span>
        <span className="ml-auto">
          {isProcessing ? (
            stuck ? (
              <span className="flex items-center gap-1 text-amber-500 dark:text-amber-400">
                <Loader2 className="size-3 animate-spin" />
                <span className="text-[10px] font-medium">Stuck…</span>
              </span>
            ) : (
              <span className="text-[10px] font-medium text-muted-foreground">Processing</span>
            )
          ) : null}
        </span>
      </div>

      <div className="space-y-2 p-2">
        {session?.messages && session.messages.length > 0 ? (
          <div className="max-h-40 space-y-2 overflow-y-auto px-1">
            {session.messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === 'user'
                    ? 'rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-xs'
                    : 'rounded-md border border-border/40 bg-background/70 px-2 py-1.5 text-xs'
                }
              >
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {message.role === 'user' ? 'You' : 'AI'}
                </div>
                {message.text ? (
                  <div className="streamdown prose prose-xs dark:prose-invert max-w-none leading-relaxed">
                    <Streamdown>{message.text}</Streamdown>
                  </div>
                ) : null}
                {message.tools.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {message.tools.map((tool) => (
                      <span
                        key={`${message.id}-${tool.toolName}`}
                        className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        <Search className="size-2.5" />
                        {tool.toolName.replace(/_/g, ' ')}
                        {tool.state === 'pending' ? '…' : ''}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : isProcessing ? (
          <div className="flex items-center justify-center gap-2 px-2 py-3 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            <span className="text-xs">Awaiting AI response…</span>
          </div>
        ) : null}

        {isProcessing && stuck ? (
          <div className="mx-1 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            <Loader2 className="size-3 animate-spin" />
            <span>Still processing this inline request…</span>
          </div>
        ) : null}

        {choices.length > 0 ? (
          <div className="space-y-1.5 px-1 py-0.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Suggestions
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                title="Dismiss all suggestions"
                data-action="dismiss-choices"
                onPointerDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  handleDismissChoices()
                }}
              >
                <X className="size-3" />
              </Button>
            </div>

            <div className="max-h-48 space-y-1 overflow-y-auto">
              {choices.map((choice, index) => (
                <button
                  key={`${zoneId ?? 'zone'}-choice-${index}`}
                  className="group flex w-full cursor-pointer items-start gap-2 rounded-md border border-border/50 bg-background px-2.5 py-2 text-left text-xs transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  title={choice}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    selectChoice(view, choice, from, to)
                    handleDismissChoices()
                  }}
                >
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground transition-colors group-hover:bg-primary/15 group-hover:text-primary">
                    {index + 1}
                  </span>
                  <span className="line-clamp-3 leading-relaxed text-foreground/80 group-hover:text-foreground">
                    {choice}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {zoneId ? (
          <div className="space-y-1 px-1">
            <Textarea
              value={followupPrompt}
              onChange={(event) => setFollowupPrompt(event.target.value)}
              placeholder="Ask a follow-up for this AI zone..."
              className="min-h-14 text-xs"
              disabled={isProcessing}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  handleSendFollowup()
                }
              }}
            />
            <div className="flex items-center justify-end">
              <Button size="xs" disabled={!canSendFollowup} onClick={handleSendFollowup}>
                Send
              </Button>
            </div>
          </div>
        ) : null}

        {isReview && choices.length === 0 ? (
          <div className="flex items-center gap-1.5 p-1.5">
            <Button
              variant="ghost"
              size="xs"
              className="gap-1.5 text-muted-foreground hover:border-success/50 hover:bg-success/15 hover:text-success dark:hover:text-emerald-400"
              title="Accept (Tab)"
              data-action="accept"
              onPointerDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onAccept(zoneId)
              }}
            >
              <Check className="size-3" />
              Accept
              <Kbd>Tab</Kbd>
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className="gap-1.5 text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
              title="Reject (Esc)"
              data-action="reject"
              onPointerDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onReject(zoneId)
              }}
            >
              <X className="size-3" />
              Reject
              <Kbd>Esc</Kbd>
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
