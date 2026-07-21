import {
  Check,
  Code2,
  Copy,
  List,
  ListChecks,
  ListOrdered,
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
import {
  isListBlockType,
  supportsListTurnInto,
  supportsTurnInto,
} from '../prosemirror/block-resolve'
import { supportsTurnIntoNote } from '../notes/note-transforms'

const PROTECTED_BLOCK_ACTIONS = new Set<BlockActionId>([
  'turn-into-paragraph',
  'turn-into-code',
  'turn-into-unordered-list',
  'turn-into-ordered-list',
  'turn-into-task-list',
  'turn-into-note',
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
  {
    id: 'insert-unordered-list',
    label: 'Unordered list',
    icon: List,
  },
  {
    id: 'insert-ordered-list',
    label: 'Ordered list',
    icon: ListOrdered,
  },
  {
    id: 'insert-task-list',
    label: 'Task list',
    icon: ListChecks,
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
  {
    id: 'turn-into-note',
    label: 'Note',
    icon: MessageSquareText,
    isEnabled: (info) => supportsTurnIntoNote(info.node),
  },
  {
    id: 'turn-into-unordered-list',
    label: 'Unordered list',
    icon: List,
    isEnabled: (info) => supportsListTurnInto(info.node),
    isChecked: (info) => info.node.type.name === 'bullet_list' && info.node.attrs.kind !== 'task',
  },
  {
    id: 'turn-into-ordered-list',
    label: 'Ordered list',
    icon: ListOrdered,
    isEnabled: (info) => supportsListTurnInto(info.node),
    isChecked: (info) => info.node.type.name === 'ordered_list',
  },
  {
    id: 'turn-into-task-list',
    label: 'Task list',
    icon: ListChecks,
    isEnabled: (info) => supportsListTurnInto(info.node),
    isChecked: (info) => info.node.type.name === 'bullet_list' && info.node.attrs.kind === 'task',
  },
]

export const listTurnIntoBlockMenuItems = turnIntoBlockMenuItems.slice(-3)

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
    isEnabled: (info) => info.node.type.name !== 'note_marker',
  },
  {
    id: 'delete',
    label: 'Delete',
    icon: Trash2,
    destructive: true,
  },
]

export function getTurnIntoBlockMenuItems(info: ActiveBlockInfo): BlockMenuItem[] {
  return isListBlockType(info.node.type.name) ? listTurnIntoBlockMenuItems : turnIntoBlockMenuItems
}

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
