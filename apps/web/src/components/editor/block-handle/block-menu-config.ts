import {
  Check,
  Code2,
  Copy,
  MessageSquareText,
  MoreHorizontal,
  Pilcrow,
  Plus,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import type { EditorView } from 'prosemirror-view'
import { blockOverlapsProtectedZone } from '../ai/ai-zone-protection'
import type { ActiveBlockInfo, BlockActionId } from '../prosemirror/block-resolve'
import { supportsTurnInto } from '../prosemirror/block-resolve'

const PROTECTED_BLOCK_ACTIONS = new Set<BlockActionId>([
  'turn-into-paragraph',
  'turn-into-code',
  'duplicate',
  'delete',
])

function isBlockedByProtectedZone(view: EditorView | undefined, info: ActiveBlockInfo): boolean {
  if (!view) return false
  return blockOverlapsProtectedZone(view, info.pos, info.node.nodeSize)
}

export interface BlockMenuItem {
  id: BlockActionId
  label: string
  icon: LucideIcon
  destructive?: boolean
  isEnabled?: (info: ActiveBlockInfo) => boolean
  isChecked?: (info: ActiveBlockInfo) => boolean
}

export const insertBlockMenuItems: BlockMenuItem[] = [
  {
    id: 'insert-paragraph',
    label: 'Paragraph',
    icon: Pilcrow,
  },
  {
    id: 'insert-code',
    label: 'Code block',
    icon: Code2,
  },
]

export const turnIntoBlockMenuItems: BlockMenuItem[] = [
  {
    id: 'turn-into-paragraph',
    label: 'Paragraph',
    icon: Pilcrow,
    isEnabled: (info) => supportsTurnInto(info.node),
    isChecked: (info) => info.node.type.name === 'paragraph',
  },
  {
    id: 'turn-into-code',
    label: 'Code block',
    icon: Code2,
    isEnabled: (info) => supportsTurnInto(info.node),
    isChecked: (info) => info.node.type.name === 'code_block',
  },
]

export const moreBlockMenuItems: BlockMenuItem[] = [
  {
    id: 'add-note',
    label: 'Add note',
    icon: MessageSquareText,
  },
  {
    id: 'duplicate',
    label: 'Duplicate',
    icon: Copy,
  },
  {
    id: 'delete',
    label: 'Delete',
    icon: Trash2,
    destructive: true,
  },
]

export function isProtectedBlockAction(action: BlockActionId): boolean {
  return PROTECTED_BLOCK_ACTIONS.has(action) || action === 'move-up' || action === 'move-down'
}

export const mobilePrimaryIcons = {
  insert: Plus,
  turnInto: Pilcrow,
  more: MoreHorizontal,
} as const

export function isBlockMenuItemEnabled(
  item: BlockMenuItem,
  info: ActiveBlockInfo,
  view?: EditorView
): boolean {
  if (PROTECTED_BLOCK_ACTIONS.has(item.id) && isBlockedByProtectedZone(view, info)) {
    return false
  }
  return item.isEnabled?.(info) ?? true
}

export function isBlockMenuItemChecked(item: BlockMenuItem, info: ActiveBlockInfo): boolean {
  return item.isChecked?.(info) ?? false
}

export { Check }
