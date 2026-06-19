import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorView } from 'prosemirror-view'
import { ArrowDown, ArrowUp, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ActiveBlockInfo, BlockActionId } from '../prosemirror/block-resolve'
import { canMoveBlockDown, canMoveBlockUp } from '../prosemirror/block-resolve'
import { blockOverlapsProtectedZone } from '../ai/ai-zone-protection'
import { handleBlockAction } from '../prosemirror/block-actions'
import {
  insertBlockMenuItems,
  isBlockMenuItemChecked,
  isBlockMenuItemEnabled,
  mobilePrimaryIcons,
  moreBlockMenuItems,
  turnIntoBlockMenuItems,
  type BlockMenuItem,
} from './block-menu-config'
import { addNoteForBlock } from '../notes/note-actions'
import type * as Y from 'yjs'

type ExpandPanel = 'insert' | 'turn-into' | null

interface MobileBlockBarProps {
  view: EditorView
  activeBlock: ActiveBlockInfo
  stacked?: boolean
  onInteractionChange: (interacting: boolean) => void
  notesMap?: Y.Map<unknown> | null
  currentUserId?: string
  onNoteCreated?: (noteId: string, blockId: string) => void
}

function preventFocusSteal(event: React.PointerEvent) {
  event.preventDefault()
}

export function MobileBlockBar({
  view,
  activeBlock,
  stacked = false,
  onInteractionChange,
  notesMap,
  currentUserId,
  onNoteCreated,
}: MobileBlockBarProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [expandPanel, setExpandPanel] = useState<ExpandPanel>(null)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const { doc } = view.state
  const blockProtected = blockOverlapsProtectedZone(
    view,
    activeBlock.pos,
    activeBlock.node.nodeSize
  )
  const canMoveUp = !blockProtected && canMoveBlockUp(doc, activeBlock.pos)
  const canMoveDown =
    !blockProtected && canMoveBlockDown(doc, activeBlock.pos, activeBlock.node.nodeSize)

  const runAction = useCallback(
    (action: BlockActionId) => {
      if (action === 'add-note') {
        if (notesMap && currentUserId) {
          const created = addNoteForBlock(view, activeBlock, notesMap, currentUserId)
          if (created) onNoteCreated?.(created.id, created.blockId)
        }
        setExpandPanel(null)
        setMoreMenuOpen(false)
        return
      }
      handleBlockAction(view, action, activeBlock)
      setExpandPanel(null)
      setMoreMenuOpen(false)
    },
    [view, activeBlock, notesMap, currentUserId, onNoteCreated]
  )

  const togglePanel = (panel: ExpandPanel) => {
    setExpandPanel((current) => (current === panel ? null : panel))
  }

  useEffect(() => {
    return () => {
      onInteractionChange(false)
    }
  }, [onInteractionChange])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!event.target || !(event.target instanceof Node)) return
      if (root.contains(event.target)) return
      onInteractionChange(false)
      setExpandPanel(null)
      setMoreMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [onInteractionChange])

  const InsertIcon = mobilePrimaryIcons.insert
  const TurnIntoIcon = mobilePrimaryIcons.turnInto
  const MoreIcon = mobilePrimaryIcons.more

  return (
    <div
      ref={rootRef}
      className={`ai-inline-mobile-block-bar${stacked ? ' ai-inline-mobile-block-bar--stacked' : ''}`}
      onPointerDownCapture={() => onInteractionChange(true)}
      onFocusCapture={() => onInteractionChange(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget
        if (
          !nextTarget ||
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          if (!moreMenuOpen) {
            onInteractionChange(false)
          }
        }
      }}
    >
      <div className="ai-inline-mobile-block-bar__row">
        <span className="ai-inline-mobile-block-bar__label">Block</span>
        <div className="ai-inline-mobile-block-bar__actions">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ai-inline-mobile-block-bar__btn"
            aria-label="Move block up"
            disabled={!canMoveUp}
            onPointerDown={preventFocusSteal}
            onClick={() => runAction('move-up')}
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ai-inline-mobile-block-bar__btn"
            aria-label="Move block down"
            disabled={!canMoveDown}
            onPointerDown={preventFocusSteal}
            onClick={() => runAction('move-down')}
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button
            type="button"
            variant={expandPanel === 'insert' ? 'secondary' : 'ghost'}
            size="icon"
            className="ai-inline-mobile-block-bar__btn"
            aria-label="Insert block below"
            aria-expanded={expandPanel === 'insert'}
            onPointerDown={preventFocusSteal}
            onClick={() => togglePanel('insert')}
          >
            <InsertIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant={expandPanel === 'turn-into' ? 'secondary' : 'ghost'}
            size="icon"
            className="ai-inline-mobile-block-bar__btn"
            aria-label="Turn block into"
            aria-expanded={expandPanel === 'turn-into'}
            disabled={blockProtected}
            onPointerDown={preventFocusSteal}
            onClick={() => togglePanel('turn-into')}
          >
            <TurnIntoIcon className="size-4" />
          </Button>
          <DropdownMenu
            open={moreMenuOpen}
            onOpenChange={(open) => {
              setMoreMenuOpen(open)
              if (open) {
                onInteractionChange(true)
              } else if (!expandPanel) {
                onInteractionChange(false)
              }
            }}
          >
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ai-inline-mobile-block-bar__btn"
                  aria-label="More block actions"
                  onPointerDown={preventFocusSteal}
                >
                  <MoreIcon className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" side="top" sideOffset={8}>
              {moreBlockMenuItems.map((item) => (
                <MobileBlockMenuItem
                  key={item.id}
                  item={item}
                  block={activeBlock}
                  view={view}
                  onAction={runAction}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {expandPanel === 'insert' ? (
        <MobileBlockExpandPanel
          title="Insert below"
          items={insertBlockMenuItems}
          block={activeBlock}
          view={view}
          onAction={runAction}
        />
      ) : null}

      {expandPanel === 'turn-into' ? (
        <MobileBlockExpandPanel
          title="Turn into"
          items={turnIntoBlockMenuItems}
          block={activeBlock}
          view={view}
          onAction={runAction}
          showChecked
        />
      ) : null}
    </div>
  )
}

function MobileBlockExpandPanel({
  title,
  items,
  block,
  view,
  onAction,
  showChecked = false,
}: {
  title: string
  items: BlockMenuItem[]
  block: ActiveBlockInfo
  view: EditorView
  onAction: (action: BlockActionId) => void
  showChecked?: boolean
}) {
  return (
    <div className="ai-inline-mobile-block-expand">
      <p className="ai-inline-mobile-block-expand__title">{title}</p>
      <div className="ai-inline-mobile-block-expand__list">
        {items.map((item) => {
          const Icon = item.icon
          const enabled = isBlockMenuItemEnabled(item, block, view)
          const checked = showChecked && isBlockMenuItemChecked(item, block)

          return (
            <button
              key={item.id}
              type="button"
              className="ai-inline-mobile-block-expand__option"
              disabled={!enabled}
              onPointerDown={preventFocusSteal}
              onClick={() => onAction(item.id)}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 text-left">{item.label}</span>
              {checked ? <Check className="size-4 shrink-0 opacity-70" /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function MobileBlockMenuItem({
  item,
  block,
  view,
  onAction,
}: {
  item: BlockMenuItem
  block: ActiveBlockInfo
  view: EditorView
  onAction: (action: BlockActionId) => void
}) {
  const Icon = item.icon
  const enabled = isBlockMenuItemEnabled(item, block, view)

  return (
    <DropdownMenuItem
      disabled={!enabled}
      variant={item.destructive ? 'destructive' : 'default'}
      onPointerDown={preventFocusSteal}
      onClick={() => onAction(item.id)}
    >
      <Icon className="size-4" />
      <span>{item.label}</span>
    </DropdownMenuItem>
  )
}
