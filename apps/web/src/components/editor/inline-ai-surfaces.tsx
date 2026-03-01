import { useEffect } from 'react'
import { Bold, Check, Italic, Loader2, Pen, X } from 'lucide-react'
import type { EditorView } from 'prosemirror-view'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Textarea } from '@/components/ui/textarea'
import type { AIMode } from './ai-writer-plugin'
import type { AnimationPhase, FormatMarkName, InlineControlState } from './inline-ai-types'
import { selectChoice } from './inline-ai-utils'

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
  mode: AIMode | null
  state: InlineControlState
  choices: string[]
  stuck: boolean
  onAccept: (zoneId?: string) => void
  onReject: (zoneId?: string) => void
}

export function AIZoneSurface({
  rootRef,
  className,
  animationPhase = 'idle',
  view,
  zoneId,
  from,
  to,
  mode,
  state,
  choices,
  stuck,
  onAccept,
  onReject,
}: AIZoneSurfaceProps) {
  const isProcessing = state === 'processing'
  const isReview = state === 'review'

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
          {isProcessing ? 'Loading' : 'AI Zone'}
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

      {isProcessing ? (
        <div className="flex items-center justify-center gap-2 px-4 py-3 text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          <span className="text-xs">Awaiting AI response…</span>
        </div>
      ) : mode === 'choices' ? (
        <>
          {!choices || choices.length === 0 ? (
            <div className="flex items-center justify-center gap-2 px-4 py-3 text-muted-foreground">
              <span className="ai-fc-dot" />
              <span className="ai-fc-dot" />
              <span className="ai-fc-dot" />
              <span className="ml-1 text-xs">Generating options…</span>
            </div>
          ) : (
            <div
              className="grid gap-1 p-2"
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
                maxWidth: '320px',
              }}
            >
              {choices.map((choice, index) => (
                <Button
                  key={`${zoneId ?? 'zone'}-choice-${index}`}
                  variant="outline"
                  size="xs"
                  className="truncate"
                  title={choice}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    selectChoice(view, choice, from, to)
                  }}
                >
                  {choice}
                </Button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end p-1.5 pt-0">
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
        </>
      ) : isReview ? (
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
  )
}
