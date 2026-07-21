import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { EditorView } from 'prosemirror-view'
import { GripVertical, Plus } from 'lucide-react'
import { NodeSelection } from 'prosemirror-state'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Check } from 'lucide-react'
import { computeBlockHandleLayout, isPointerInBlockHoverZone } from '../side-elements/layout'
import { useSideElement } from '../side-elements/use-side-element'
import {
  resolveActiveBlockFromClientY,
  isActiveBlockInDoc,
  refreshActiveBlock,
  type ActiveBlockInfo,
} from '../prosemirror/block-resolve'
import { blockOverlapsProtectedZone } from '../ai/ai-zone-protection'
import { handleBlockAction } from '../prosemirror/block-actions'
import { setDraggedBlock, clearDraggedBlock } from '../prosemirror/block-drag-plugin'
import { subscribeEditorView } from '../prosemirror/view-store'
import { useIsCoarsePointer } from '../inline/hooks'
import { emitAIZoneControlLayoutChange } from '../inline/layout-events'
import {
  insertBlockMenuItems,
  getTurnIntoBlockMenuItems,
  isBlockMenuItemChecked,
  isBlockMenuItemEnabled,
  moreBlockMenuItems,
  type BlockMenuItem,
} from './block-menu-config'
import { addNoteForBlock } from '../notes/note-actions'
import { turnBlockIntoNote } from '../notes/note-transforms'
import type { BlockActionId } from '../prosemirror/block-resolve'
import type * as Y from 'yjs'

interface BlockHandleProps {
  view: EditorView | null
  container: HTMLElement | null
  notesMap?: Y.Map<unknown> | null
  noteCreatorUserId: string
  onNoteCreated?: (noteId: string, anchorId: string) => void
}

interface HandleSnapshot {
  left: number
  top: number
  height: number
}

export function BlockHandle({
  view,
  container,
  notesMap,
  noteCreatorUserId,
  onNoteCreated,
}: BlockHandleProps) {
  const isCoarsePointer = useIsCoarsePointer()
  const [activeBlock, setActiveBlock] = useState<ActiveBlockInfo | null>(null)
  const [lastActiveBlock, setLastActiveBlock] = useState<ActiveBlockInfo | null>(null)
  const [isHoveringHandle, setIsHoveringHandle] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [latchedDragBlock, setLatchedDragBlock] = useState<ActiveBlockInfo | null>(null)
  const [menuOpen, setMenuOpen] = useState<'insert' | 'actions' | null>(null)
  const [pinnedBlock, setPinnedBlock] = useState<ActiveBlockInfo | null>(null)
  const [snapshot, setSnapshot] = useState<HandleSnapshot | null>(null)
  const dragStartedRef = useRef(false)
  const gripRef = useRef<HTMLDivElement>(null)
  const effectiveBlockRef = useRef<ActiveBlockInfo | null>(null)
  const hoveredBlockPosRef = useRef<number | null>(null)
  const lastMouseRef = useRef<{ x: number; y: number } | null>(null)
  const menuOpenRef = useRef<'insert' | 'actions' | null>(null)
  const isHoveringHandleRef = useRef(false)
  const pinnedBlockRef = useRef<ActiveBlockInfo | null>(null)
  const isDraggingRef = useRef(false)
  const latchedDragBlockRef = useRef<ActiveBlockInfo | null>(null)

  const hoverRoot = container?.closest('main') ?? container

  const effectiveBlock = isDragging
    ? (latchedDragBlock ?? lastActiveBlock)
    : menuOpen !== null
      ? (pinnedBlock ?? lastActiveBlock)
      : isHoveringHandle
        ? (activeBlock ?? lastActiveBlock)
        : activeBlock

  useEffect(() => {
    isDraggingRef.current = isDragging
  }, [isDragging])

  useEffect(() => {
    latchedDragBlockRef.current = latchedDragBlock
  }, [latchedDragBlock])

  useEffect(() => {
    effectiveBlockRef.current = effectiveBlock
  }, [effectiveBlock])

  useEffect(() => {
    menuOpenRef.current = menuOpen
  }, [menuOpen])

  useEffect(() => {
    isHoveringHandleRef.current = isHoveringHandle
  }, [isHoveringHandle])

  useEffect(() => {
    pinnedBlockRef.current = pinnedBlock
  }, [pinnedBlock])

  const resolveBlockFromPointer = useCallback(
    (clientX: number, clientY: number): ActiveBlockInfo | null => {
      if (!view || !hoverRoot) return null
      const hoverRootRect = hoverRoot.getBoundingClientRect()
      if (!isPointerInBlockHoverZone(view, hoverRootRect, clientX, clientY)) return null
      return resolveActiveBlockFromClientY(view, clientY)
    },
    [view, hoverRoot]
  )

  const clearHandleState = useCallback(() => {
    hoveredBlockPosRef.current = null
    isDraggingRef.current = false
    setIsDragging(false)
    setLatchedDragBlock(null)
    setActiveBlock(null)
    setLastActiveBlock(null)
    setPinnedBlock(null)
    setMenuOpen(null)
    setSnapshot(null)
    setIsHoveringHandle(false)
    clearDraggedBlock()
  }, [])

  const validateAndRefreshBlock = useCallback(
    (block: ActiveBlockInfo | null): ActiveBlockInfo | null => {
      if (!view || !block) return null
      if (!isActiveBlockInDoc(view, block)) return null
      return refreshActiveBlock(view, block) ?? null
    },
    [view]
  )

  const syncSnapshot = useCallback(
    (block: ActiveBlockInfo | null) => {
      if (!view || !container || !block) {
        setSnapshot(null)
        return
      }

      const validated = validateAndRefreshBlock(block)
      if (!validated) {
        if (!isDraggingRef.current) {
          clearHandleState()
          hoveredBlockPosRef.current = null
        }
        return
      }

      const containerRect = container.getBoundingClientRect()
      const layout = computeBlockHandleLayout(view, containerRect, validated)
      const next: HandleSnapshot = {
        left: layout.left,
        top: layout.top,
        height: layout.height,
      }

      setSnapshot((previous) =>
        previous &&
        Math.round(previous.left) === Math.round(next.left) &&
        Math.round(previous.top) === Math.round(next.top) &&
        Math.round(previous.height) === Math.round(next.height)
          ? previous
          : next
      )
    },
    [view, container, validateAndRefreshBlock, clearHandleState]
  )

  const setHoveredBlock = useCallback(
    (block: ActiveBlockInfo | null) => {
      if (isDraggingRef.current) return

      if (!block) {
        if (hoveredBlockPosRef.current !== null) {
          hoveredBlockPosRef.current = null
          setActiveBlock(null)
          setSnapshot(null)
        }
        return
      }

      if (hoveredBlockPosRef.current === block.pos) return

      hoveredBlockPosRef.current = block.pos
      setActiveBlock(block)
      setLastActiveBlock(block)
      syncSnapshot(block)
    },
    [syncSnapshot]
  )

  const finishDrag = useCallback(
    (event?: DragEvent) => {
      if (!isDraggingRef.current) return

      dragStartedRef.current = false
      isDraggingRef.current = false
      latchedDragBlockRef.current = null
      setIsDragging(false)
      setLatchedDragBlock(null)
      clearDraggedBlock()

      if (event) {
        lastMouseRef.current = { x: event.clientX, y: event.clientY }
      }

      const resolveHoverAtPointer = () => {
        if (!lastMouseRef.current) {
          syncSnapshot(null)
          return
        }

        hoveredBlockPosRef.current = null
        setHoveredBlock(resolveBlockFromPointer(lastMouseRef.current.x, lastMouseRef.current.y))
      }

      // Wait for drop transaction to settle before resolving block at pointer Y.
      requestAnimationFrame(resolveHoverAtPointer)
    },
    [resolveBlockFromPointer, setHoveredBlock, syncSnapshot]
  )

  useEffect(() => {
    if (!view || !container || isCoarsePointer) return

    let cancelled = false
    let rafId = 0

    const refreshFromDocument = () => {
      if (cancelled) return

      if (isDraggingRef.current) {
        syncSnapshot(latchedDragBlockRef.current ?? effectiveBlockRef.current)
        return
      }

      if (!isHoveringHandleRef.current && menuOpenRef.current === null && lastMouseRef.current) {
        const fromPointer = resolveBlockFromPointer(lastMouseRef.current.x, lastMouseRef.current.y)
        if (fromPointer?.pos !== effectiveBlockRef.current?.pos) {
          setHoveredBlock(fromPointer)
          return
        }
        if (!fromPointer) {
          setHoveredBlock(null)
          return
        }
      }

      syncSnapshot(effectiveBlockRef.current)
    }

    const scheduleRefresh = () => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(refreshFromDocument)
    }

    scheduleRefresh()
    const unsubscribe = subscribeEditorView(view, scheduleRefresh)
    const resizeObserver = new ResizeObserver(scheduleRefresh)
    resizeObserver.observe(view.dom as HTMLElement)
    resizeObserver.observe(container)
    if (hoverRoot && hoverRoot !== container) {
      resizeObserver.observe(hoverRoot)
    }
    window.addEventListener('resize', scheduleRefresh)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      unsubscribe()
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleRefresh)
    }
  }, [
    view,
    container,
    hoverRoot,
    isCoarsePointer,
    syncSnapshot,
    resolveBlockFromPointer,
    setHoveredBlock,
  ])

  useEffect(() => {
    if (!view || !container || isCoarsePointer) return

    const trackDragPointer = (event: DragEvent) => {
      if (!isDraggingRef.current) return
      lastMouseRef.current = { x: event.clientX, y: event.clientY }
    }

    document.addEventListener('dragend', finishDrag)
    document.addEventListener('dragover', trackDragPointer)
    return () => {
      document.removeEventListener('dragend', finishDrag)
      document.removeEventListener('dragover', trackDragPointer)
    }
  }, [view, container, isCoarsePointer, finishDrag])

  useEffect(() => {
    if (!view || !container || isCoarsePointer) return

    const handleMouseMove = (event: MouseEvent) => {
      if (isDraggingRef.current || menuOpenRef.current !== null || isHoveringHandleRef.current) {
        return
      }

      lastMouseRef.current = { x: event.clientX, y: event.clientY }
      setHoveredBlock(resolveBlockFromPointer(event.clientX, event.clientY))
    }

    window.addEventListener('mousemove', handleMouseMove)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
    }
  }, [view, container, isCoarsePointer, resolveBlockFromPointer, setHoveredBlock])

  const runAction = useCallback(
    (action: BlockActionId) => {
      if (!view || !effectiveBlock) return
      if (action === 'add-note') {
        if (!notesMap) return
        const created = addNoteForBlock(view, effectiveBlock, notesMap, noteCreatorUserId)
        if (created) onNoteCreated?.(created.id, created.anchorId)
        setMenuOpen(null)
        return
      }
      if (action === 'turn-into-note') {
        if (!notesMap) return
        const created = turnBlockIntoNote(view, effectiveBlock, notesMap, noteCreatorUserId)
        if (created) onNoteCreated?.(created.id, created.anchorId)
        setMenuOpen(null)
        return
      }
      handleBlockAction(view, action, effectiveBlock)
      setMenuOpen(null)
      if (action === 'delete') {
        clearHandleState()
      }
    },
    [view, effectiveBlock, clearHandleState, notesMap, noteCreatorUserId, onNoteCreated]
  )

  const onGripMouseDown = () => {
    dragStartedRef.current = false
  }

  const onGripClick = (event: React.MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()

    if (dragStartedRef.current) {
      dragStartedRef.current = false
      return
    }

    handleMenuOpenChange('actions', true)
  }

  const onDragStart = (event: React.DragEvent) => {
    if (!view || !effectiveBlock) return
    if (blockOverlapsProtectedZone(view, effectiveBlock.pos, effectiveBlock.node.nodeSize)) {
      event.preventDefault()
      return
    }
    dragStartedRef.current = true
    isDraggingRef.current = true
    setIsDragging(true)
    setLatchedDragBlock(effectiveBlock)
    setLastActiveBlock(effectiveBlock)

    const tr = view.state.tr
    const sel = NodeSelection.create(view.state.doc, effectiveBlock.pos)
    view.dispatch(tr.setSelection(sel))
    setDraggedBlock(effectiveBlock.pos, effectiveBlock.node)

    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', effectiveBlock.node.textContent)

    if (effectiveBlock.dom.isConnected) {
      event.dataTransfer.setDragImage(
        effectiveBlock.dom,
        Math.min(20, effectiveBlock.dom.clientWidth / 2),
        12
      )
    }
  }

  const onDragEnd = (event: React.DragEvent) => {
    finishDrag(event.nativeEvent)
  }

  const handleMenuOpenChange = (kind: 'insert' | 'actions', open: boolean) => {
    if (open) {
      const block = activeBlock ?? lastActiveBlock
      if (block) {
        setPinnedBlock(block)
        setLastActiveBlock(block)
      }
    } else {
      setPinnedBlock(null)
    }
    setMenuOpen(open ? kind : null)
    emitAIZoneControlLayoutChange()
  }

  const blockProtected =
    view && effectiveBlock
      ? blockOverlapsProtectedZone(view, effectiveBlock.pos, effectiveBlock.node.nodeSize)
      : false

  const { measureRef } = useSideElement({
    id: 'block-handle-active',
    gutter: 'left',
    desiredTop: snapshot?.top ?? 0,
    order: 0,
    enabled: Boolean(
      !isCoarsePointer && view && container && snapshot && effectiveBlock && !blockProtected
    ),
  })

  if (isCoarsePointer || !view || !container || !effectiveBlock || !snapshot) {
    return null
  }

  if (blockProtected) {
    return null
  }

  return (
    <div
      ref={measureRef}
      className={`block-handle pointer-events-auto absolute z-59 flex items-center gap-0.5${isDragging ? ' opacity-50' : ''}`}
      style={{
        left: `${Math.round(snapshot.left)}px`,
        top: `${Math.round(snapshot.top)}px`,
        height: `${Math.round(snapshot.height)}px`,
      }}
      onMouseEnter={() => setIsHoveringHandle(true)}
      onMouseLeave={() => setIsHoveringHandle(false)}
    >
      <BlockHandleMenu
        open={menuOpen === 'insert'}
        onOpenChange={(open) => handleMenuOpenChange('insert', open)}
        trigger={
          <button type="button" className="block-handle-btn" aria-label="Insert block">
            <Plus className="size-3.5" />
          </button>
        }
        items={insertBlockMenuItems}
        block={effectiveBlock}
        view={view}
        onAction={runAction}
      />

      <div
        ref={gripRef}
        draggable
        role="button"
        tabIndex={0}
        className="block-handle-btn block-handle-grip cursor-grab active:cursor-grabbing"
        aria-label="Drag block or open actions"
        onMouseDown={onGripMouseDown}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={onGripClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handleMenuOpenChange('actions', true)
          }
        }}
      >
        <GripVertical className="size-3.5" />
      </div>

      <BlockHandleMenu
        open={menuOpen === 'actions'}
        onOpenChange={(open) => handleMenuOpenChange('actions', open)}
        anchor={gripRef}
        items={[...getTurnIntoBlockMenuItems(effectiveBlock), ...moreBlockMenuItems]}
        block={effectiveBlock}
        view={view}
        onAction={runAction}
        showTurnIntoLabel
      />
    </div>
  )
}

interface BlockHandleMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger?: ReactNode
  anchor?: React.RefObject<Element | null>
  items: BlockMenuItem[]
  block: ActiveBlockInfo
  view: EditorView
  onAction: (action: BlockActionId) => void
  showTurnIntoLabel?: boolean
}

function BlockHandleMenu({
  open,
  onOpenChange,
  trigger,
  anchor,
  items,
  block,
  view,
  onAction,
  showTurnIntoLabel = false,
}: BlockHandleMenuProps) {
  const turnIntoItems = getTurnIntoBlockMenuItems(block)
  const moreItems = moreBlockMenuItems

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      {trigger ? (
        <DropdownMenuTrigger render={<span className="inline-flex">{trigger}</span>} />
      ) : null}
      <DropdownMenuContent align="start" side="bottom" anchor={anchor}>
        {showTurnIntoLabel ? (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Turn into</DropdownMenuLabel>
              {turnIntoItems.map((item) => (
                <BlockMenuDropdownItem
                  key={item.id}
                  item={item}
                  block={block}
                  view={view}
                  onAction={onAction}
                />
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {moreItems.map((item) => (
                <BlockMenuDropdownItem
                  key={item.id}
                  item={item}
                  block={block}
                  view={view}
                  onAction={onAction}
                />
              ))}
            </DropdownMenuGroup>
          </>
        ) : (
          items.map((item) => (
            <BlockMenuDropdownItem
              key={item.id}
              item={item}
              block={block}
              view={view}
              onAction={onAction}
            />
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function BlockMenuDropdownItem({
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
  const checked = isBlockMenuItemChecked(item, block)

  return (
    <DropdownMenuItem
      disabled={!enabled}
      variant={item.destructive ? 'destructive' : 'default'}
      onClick={() => onAction(item.id)}
    >
      <Icon className="size-4" />
      <span className="flex-1">{item.label}</span>
      {checked ? <Check className="size-4 opacity-70" /> : null}
    </DropdownMenuItem>
  )
}
