import type { UIMessage } from 'ai'

export interface ChatTreeNode {
  id: string
  role: 'user' | 'assistant'
  parts: unknown[]
  parentId: string | null
  childIds: string[]
  selectedChildId: string | null
}

export interface ChatTreeSnapshot {
  nodes: Record<string, ChatTreeNode>
  rootChildIds: string[]
  selectedRootChildId: string | null
}

export interface BranchMeta {
  index: number
  count: number
  siblingIds: string[]
}

export function getBranchMeta(tree: ChatTreeSnapshot, nodeId: string): BranchMeta {
  const node = tree.nodes[nodeId]
  if (!node) {
    return { index: 0, count: 1, siblingIds: [nodeId] }
  }

  const siblingIds =
    node.parentId === null
      ? tree.rootChildIds
      : (tree.nodes[node.parentId]?.childIds ?? [nodeId])
  const index = siblingIds.indexOf(nodeId)

  return {
    index: index >= 0 ? index : 0,
    count: siblingIds.length,
    siblingIds: [...siblingIds],
  }
}

export function canContinueConversation(messages: UIMessage[]): boolean {
  if (messages.length === 0) return false
  return messages[messages.length - 1]?.role === 'user'
}
