import { nanoid } from 'nanoid'
import type { UIMessage } from 'ai'
import type { ChatThreadPayload, ChatTreeNode } from '../core/services/chat-thread-payload.js'
import { ChatRuntimeError } from './utils.js'

export type DeleteChatMessageMode = 'only' | 'from_here' | 'branch'

export interface BranchMeta {
  index: number
  count: number
  siblingIds: string[]
}

export interface ChatTreeSnapshot {
  nodes: Record<string, ChatTreeNode>
  rootChildIds: string[]
  selectedRootChildId: string | null
}

function clonePayload(payload: ChatThreadPayload): ChatThreadPayload {
  return structuredClone(payload)
}

function cloneParts(parts: unknown[]): unknown[] {
  return structuredClone(parts)
}

function nodeToUIMessage(node: ChatTreeNode): UIMessage {
  return {
    id: node.id,
    role: node.role,
    parts: node.parts as UIMessage['parts'],
  }
}

function findNode(payload: ChatThreadPayload, nodeId: string): ChatTreeNode {
  const node = payload.nodes[nodeId]
  if (!node) {
    throw new ChatRuntimeError('NOT_FOUND', `Chat message ${nodeId} not found`)
  }
  return node
}

function getSiblingList(
  payload: ChatThreadPayload,
  node: ChatTreeNode
): { list: string[]; isRoot: boolean; parent: ChatTreeNode | null } {
  if (node.parentId === null) {
    return { list: payload.rootChildIds, isRoot: true, parent: null }
  }
  const parent = findNode(payload, node.parentId)
  return { list: parent.childIds, isRoot: false, parent }
}

function assertOnActivePath(payload: ChatThreadPayload, nodeId: string): void {
  const path = resolveActivePath(payload)
  if (!path.some((node) => node.id === nodeId)) {
    throw new ChatRuntimeError('BAD_REQUEST', 'Message is not on the active conversation path.')
  }
}

function collectSubtreeNodeIds(payload: ChatThreadPayload, rootId: string): Set<string> {
  const ids = new Set<string>()
  const stack = [rootId]

  while (stack.length > 0) {
    const id = stack.pop()!
    if (ids.has(id)) continue
    ids.add(id)
    const node = payload.nodes[id]
    if (!node) continue
    for (const childId of node.childIds) {
      stack.push(childId)
    }
  }

  return ids
}

function removeNodesFromPayload(next: ChatThreadPayload, idsToRemove: Set<string>): void {
  for (const id of idsToRemove) {
    delete next.nodes[id]
  }

  next.rootChildIds = next.rootChildIds.filter((id) => !idsToRemove.has(id))
  if (next.selectedRootChildId && idsToRemove.has(next.selectedRootChildId)) {
    next.selectedRootChildId = null
  }

  for (const node of Object.values(next.nodes)) {
    node.childIds = node.childIds.filter((id) => !idsToRemove.has(id))
    if (node.selectedChildId && idsToRemove.has(node.selectedChildId)) {
      node.selectedChildId = null
    }
  }
}

function deleteBranchSubtree(
  next: ChatThreadPayload,
  nodeId: string
): void {
  const node = findNode(next, nodeId)
  const { list, isRoot, parent } = getSiblingList(next, node)
  const index = list.indexOf(nodeId)
  if (index >= 0) {
    list.splice(index, 1)
  }

  const wasSelected = isRoot
    ? next.selectedRootChildId === nodeId
    : parent?.selectedChildId === nodeId

  if (wasSelected) {
    const fallback = list[index] ?? list[index - 1] ?? null
    if (isRoot) {
      next.selectedRootChildId = fallback
    } else if (parent) {
      parent.selectedChildId = fallback
    }
  }

  removeNodesFromPayload(next, collectSubtreeNodeIds(next, nodeId))
}

export function resolveActivePath(payload: ChatThreadPayload): ChatTreeNode[] {
  const path: ChatTreeNode[] = []
  let currentId = payload.selectedRootChildId

  while (currentId) {
    const node = payload.nodes[currentId]
    if (!node) break
    path.push(node)
    currentId = node.selectedChildId
  }

  return path
}

export function pathToUIMessages(path: ChatTreeNode[]): UIMessage[] {
  return path.map(nodeToUIMessage)
}

export function getBranchMeta(payload: ChatThreadPayload, nodeId: string): BranchMeta {
  const node = findNode(payload, nodeId)
  const { list } = getSiblingList(payload, node)
  const index = list.indexOf(nodeId)
  return {
    index: index >= 0 ? index : 0,
    count: list.length,
    siblingIds: [...list],
  }
}

export function toTreeSnapshot(payload: ChatThreadPayload): ChatTreeSnapshot {
  return {
    nodes: payload.nodes,
    rootChildIds: payload.rootChildIds,
    selectedRootChildId: payload.selectedRootChildId,
  }
}

export function selectBranch(payload: ChatThreadPayload, nodeId: string): ChatThreadPayload {
  const next = clonePayload(payload)
  const node = findNode(next, nodeId)
  const { list, isRoot, parent } = getSiblingList(next, node)

  if (!list.includes(nodeId)) {
    throw new ChatRuntimeError('BAD_REQUEST', 'Message is not a valid branch sibling.')
  }

  if (isRoot) {
    next.selectedRootChildId = nodeId
  } else if (parent) {
    parent.selectedChildId = nodeId
  }

  return next
}

export function forkRegeneration(
  payload: ChatThreadPayload,
  nodeId: string,
  options?: { text?: string }
): { payload: ChatThreadPayload; forkNodeId: string } {
  const next = clonePayload(payload)
  assertOnActivePath(next, nodeId)
  const source = findNode(next, nodeId)
  const { list, isRoot, parent } = getSiblingList(next, source)
  const normalizedText = options?.text?.trim()

  const forkId = nanoid()
  const forkNode: ChatTreeNode = {
    id: forkId,
    role: source.role,
    parts:
      source.role === 'user'
        ? normalizedText
          ? [{ type: 'text', text: normalizedText }]
          : cloneParts(source.parts)
        : [{ type: 'text', text: '' }],
    parentId: source.parentId,
    childIds: [],
    selectedChildId: null,
  }

  next.nodes[forkId] = forkNode
  list.push(forkId)

  if (isRoot) {
    next.selectedRootChildId = forkId
  } else if (parent) {
    parent.selectedChildId = forkId
  }

  return { payload: next, forkNodeId: forkId }
}

export function appendUserMessage(
  payload: ChatThreadPayload,
  text: string
): { payload: ChatThreadPayload; nodeId: string } {
  const normalizedText = text.trim()
  if (!normalizedText) {
    throw new ChatRuntimeError('BAD_REQUEST', 'Chat message text is required.')
  }

  const next = clonePayload(payload)
  const nodeId = nanoid()
  const path = resolveActivePath(next)
  const leaf = path[path.length - 1]

  const userNode: ChatTreeNode = {
    id: nodeId,
    role: 'user',
    parts: [{ type: 'text', text: normalizedText }],
    parentId: leaf?.id ?? null,
    childIds: [],
    selectedChildId: null,
  }

  next.nodes[nodeId] = userNode

  if (!leaf) {
    next.rootChildIds.push(nodeId)
    next.selectedRootChildId = nodeId
  } else {
    leaf.childIds.push(nodeId)
    leaf.selectedChildId = nodeId
  }

  return { payload: next, nodeId }
}

export function setAssistantOnActiveLeaf(
  payload: ChatThreadPayload,
  assistantId: string,
  parts: unknown[]
): ChatThreadPayload {
  const next = clonePayload(payload)
  const path = resolveActivePath(next)
  const leaf = path[path.length - 1]

  if (leaf?.role === 'assistant' && leaf.id === assistantId) {
    leaf.parts = cloneParts(parts)
    return next
  }

  if (!leaf || leaf.role !== 'user') {
    throw new ChatRuntimeError('BAD_REQUEST', 'Cannot attach assistant without a user turn.')
  }

  const existing = leaf.selectedChildId ? next.nodes[leaf.selectedChildId] : null
  if (existing?.role === 'assistant' && existing.id === assistantId) {
    existing.parts = cloneParts(parts)
    return next
  }

  const assistantNode: ChatTreeNode = {
    id: assistantId,
    role: 'assistant',
    parts: cloneParts(parts),
    parentId: leaf.id,
    childIds: [],
    selectedChildId: null,
  }

  next.nodes[assistantId] = assistantNode

  if (!leaf.childIds.includes(assistantId)) {
    leaf.childIds.push(assistantId)
  }
  leaf.selectedChildId = assistantId

  return next
}

export function replaceNodeText(
  payload: ChatThreadPayload,
  nodeId: string,
  text: string
): ChatThreadPayload {
  const normalizedText = text.trim()
  if (!normalizedText) {
    throw new ChatRuntimeError('BAD_REQUEST', 'Chat message text is required.')
  }

  const next = clonePayload(payload)
  assertOnActivePath(next, nodeId)
  const node = findNode(next, nodeId)
  const hasToolParts = node.parts.some((part) => {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) return false
    const type =
      'type' in part && typeof part.type === 'string' ? part.type : ''
    return type === 'dynamic-tool' || type.startsWith('tool-')
  })
  if (hasToolParts) {
    throw new ChatRuntimeError('BAD_REQUEST', 'Messages with tool activity cannot be edited.')
  }

  node.parts = [{ type: 'text', text: normalizedText }]
  return next
}

export function deleteNode(
  payload: ChatThreadPayload,
  nodeId: string,
  mode: DeleteChatMessageMode
): ChatThreadPayload {
  const next = clonePayload(payload)
  assertOnActivePath(next, nodeId)

  if (mode === 'branch' || mode === 'from_here') {
    deleteBranchSubtree(next, nodeId)
    return next
  }

  const node = findNode(next, nodeId)
  const { list, isRoot, parent } = getSiblingList(next, node)
  const idsToRemove = new Set<string>([nodeId])

  for (const childId of node.childIds) {
    if (childId !== node.selectedChildId) {
      for (const id of collectSubtreeNodeIds(next, childId)) {
        idsToRemove.add(id)
      }
    }
  }

  const promotedId = node.selectedChildId
  if (promotedId && next.nodes[promotedId]) {
    const promoted = next.nodes[promotedId]!
    promoted.parentId = node.parentId

    if (isRoot) {
      const rootIndex = next.rootChildIds.indexOf(nodeId)
      if (rootIndex >= 0) {
        next.rootChildIds.splice(rootIndex, 1)
      }
      if (!next.rootChildIds.includes(promotedId)) {
        next.rootChildIds.splice(rootIndex >= 0 ? rootIndex : next.rootChildIds.length, 0, promotedId)
      }
      if (next.selectedRootChildId === nodeId) {
        next.selectedRootChildId = promotedId
      }
    } else if (parent) {
      const index = parent.childIds.indexOf(nodeId)
      if (index >= 0) {
        parent.childIds.splice(index, 1)
      }
      if (!parent.childIds.includes(promotedId)) {
        parent.childIds.splice(index >= 0 ? index : parent.childIds.length, 0, promotedId)
      }
      if (parent.selectedChildId === nodeId) {
        parent.selectedChildId = promotedId
      }
    }
  } else {
    const index = list.indexOf(nodeId)
    if (index >= 0) {
      list.splice(index, 1)
    }

    const wasSelected = isRoot
      ? next.selectedRootChildId === nodeId
      : parent?.selectedChildId === nodeId

    if (wasSelected) {
      const fallback = list[index] ?? list[index - 1] ?? null
      if (isRoot) {
        next.selectedRootChildId = fallback
      } else if (parent) {
        parent.selectedChildId = fallback
      }
    }
  }

  removeNodesFromPayload(next, idsToRemove)
  return next
}

export function summarizeTitleFromPayload(payload: ChatThreadPayload): string {
  for (const node of resolveActivePath(payload)) {
    if (node.role !== 'user') continue
    const text = node.parts
      .flatMap((part) => {
        if (typeof part !== 'object' || part === null || Array.isArray(part)) return []
        const record = part as Record<string, unknown>
        if (record.type !== 'text') return []
        return typeof record.text === 'string' ? [record.text] : []
      })
      .join('')
      .trim()
    if (!text) continue
    return text.length > 80 ? `${text.slice(0, 80)}...` : text
  }
  return 'New chat'
}

export function canContinueConversationFromPayload(payload: ChatThreadPayload): boolean {
  const path = resolveActivePath(payload)
  if (path.length === 0) return false
  return path[path.length - 1]?.role === 'user'
}

export function assertCanContinueConversationFromPayload(payload: ChatThreadPayload): void {
  if (canContinueConversationFromPayload(payload)) return

  const path = resolveActivePath(payload)
  if (path.length === 0) {
    throw new ChatRuntimeError('BAD_REQUEST', 'Cannot continue an empty chat.')
  }

  throw new ChatRuntimeError(
    'BAD_REQUEST',
    'Cannot continue unless the latest message is from the author.'
  )
}
