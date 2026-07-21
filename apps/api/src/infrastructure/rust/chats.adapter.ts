import type { NativeStorageEngine } from '@lucentdocs/core'
import type {
  ChatsRepositoryPort,
  ChatThreadRow,
  UpdateChatThreadData,
} from '../../core/ports/chats.port.js'
import { currentTxId } from './tx-scope.js'
import type { AssistantMessageDto, AssistantThreadDto } from '@lucentdocs/core'

function payloadFromRows(thread: AssistantThreadDto, rows: AssistantMessageDto[]): string {
  const nodes: Record<string, Record<string, unknown>> = {}
  const children = new Map<string | null, AssistantMessageDto[]>()
  for (const row of rows) {
    const siblings = children.get(row.parentId ?? null) ?? []
    siblings.push(row)
    children.set(row.parentId ?? null, siblings)
  }
  for (const row of rows) {
    nodes[row.id] = {
      id: row.id,
      role: row.role,
      parts: JSON.parse(row.partsJson),
      parentId: row.parentId ?? null,
      childIds: (children.get(row.id) ?? []).sort((a, b) => a.branchOrdinal - b.branchOrdinal).map((child) => child.id),
      selectedChildId: row.selectedChildId ?? null,
    }
  }
  return JSON.stringify({
    v: 1,
    settings: { editingEnabled: thread.mode === 'agent' },
    nodes,
    rootChildIds: (children.get(null) ?? []).sort((a, b) => a.branchOrdinal - b.branchOrdinal).map((row) => row.id),
    selectedRootChildId: thread.selectedRootMessageId ?? null,
  })
}

function rowsFromPayload(threadId: string, raw: string, now: number): { rows: AssistantMessageDto[]; selectedRootMessageId: string | null } {
  const payload = JSON.parse(raw) as {
    nodes?: Record<string, { id: string; role: string; parts: unknown[]; parentId: string | null; childIds: string[]; selectedChildId: string | null }>
    rootChildIds?: string[]
    selectedRootChildId?: string | null
  }
  const rootOrder = new Map((payload.rootChildIds ?? []).map((id, index) => [id, index]))
  const rows = Object.values(payload.nodes ?? {}).map((node) => {
    const parent = node.parentId ? payload.nodes?.[node.parentId] : undefined
    const ordinal = parent ? Math.max(0, parent.childIds.indexOf(node.id)) : (rootOrder.get(node.id) ?? 0)
    return { id: node.id, threadId, parentId: node.parentId ?? undefined, role: node.role, partsJson: JSON.stringify(node.parts), branchOrdinal: ordinal, selectedChildId: node.selectedChildId ?? undefined, createdAt: now, updatedAt: now }
  })
  const byId = new Map(rows.map((row) => [row.id, row]))
  const depth = (row: AssistantMessageDto): number => {
    let result = 0
    let parentId = row.parentId
    const visited = new Set<string>()
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId)
      result += 1
      parentId = byId.get(parentId)?.parentId
    }
    return result
  }
  rows.sort((a, b) => depth(a) - depth(b) || a.branchOrdinal - b.branchOrdinal)
  return { rows, selectedRootMessageId: payload.selectedRootChildId ?? null }
}

async function toRow(engine: NativeStorageEngine, documentId: string, dto: AssistantThreadDto): Promise<ChatThreadRow> {
  const messages = await engine.assistantListMessages(currentTxId(), dto.id)
  return { id: dto.id, projectId: dto.projectId, documentId, title: dto.title, messages: payloadFromRows(dto, messages), createdAt: dto.createdAt, updatedAt: dto.updatedAt }
}

export class ChatsRepository implements ChatsRepositoryPort {
  constructor(private engine: NativeStorageEngine) {}

  async findById(
    projectId: string,
    documentId: string,
    id: string
  ): Promise<ChatThreadRow | undefined> {
    const row = await this.engine.assistantFindThread(currentTxId(), projectId, id)
    return row ? toRow(this.engine, documentId, row) : undefined
  }

  async listByDocument(projectId: string, documentId: string): Promise<ChatThreadRow[]> {
    const rows = await this.engine.assistantListThreads(currentTxId(), projectId)
    return Promise.all(rows.map((row) => toRow(this.engine, documentId, row)))
  }

  async listByProject(projectId: string): Promise<ChatThreadRow[]> {
    const rows = await this.engine.assistantListThreads(currentTxId(), projectId)
    return Promise.all(rows.map((row) => toRow(this.engine, '', row)))
  }

  async insert(row: ChatThreadRow): Promise<void> {
    const payload = rowsFromPayload(row.id, row.messages, row.createdAt)
    await this.engine.assistantInsertThread(currentTxId(), { id: row.id, projectId: row.projectId, createdByUserId: 'system', title: row.title, mode: JSON.parse(row.messages).settings?.editingEnabled === false ? 'ask' : 'agent', selectedRootMessageId: payload.selectedRootMessageId ?? undefined, revision: 0, createdAt: row.createdAt, updatedAt: row.updatedAt })
    await this.engine.assistantReplaceMessages(currentTxId(), row.id, payload.rows)
  }

  async update(
    projectId: string,
    documentId: string,
    id: string,
    data: UpdateChatThreadData
  ): Promise<boolean> {
    const existing = await this.engine.assistantFindThread(currentTxId(), projectId, id)
    if (!existing) return false
    let selectedRootMessageId = existing.selectedRootMessageId
    if (data.messages) {
      const payload = rowsFromPayload(id, data.messages, data.updatedAt)
      selectedRootMessageId = payload.selectedRootMessageId ?? undefined
      await this.engine.assistantReplaceMessages(currentTxId(), id, payload.rows)
    }
    return this.engine.assistantUpdateThread(currentTxId(), projectId, id, { title: data.title, mode: data.messages ? (JSON.parse(data.messages).settings?.editingEnabled === false ? 'ask' : 'agent') : undefined, selectedRootMessageId: selectedRootMessageId ?? undefined, revision: existing.revision + 1, updatedAt: data.updatedAt })
  }

  async deleteById(projectId: string, documentId: string, id: string): Promise<boolean> {
    return this.engine.assistantDeleteThread(currentTxId(), projectId, id)
  }
}
