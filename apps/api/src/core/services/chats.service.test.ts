import { describe, expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import { LOCAL_DEFAULT_USER } from '../models/user.js'
import { createTestAdapter } from '../../testing/factory.js'
import { createEmptyChatThreadPayload } from './chat-thread-payload.js'

function buildLinearPayload(messages: UIMessage[]) {
  const payload = createEmptyChatThreadPayload()
  if (messages.length === 0) return payload

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!
    const parent = index > 0 ? messages[index - 1]! : null
    payload.nodes[message.id] = {
      id: message.id,
      role: message.role === 'assistant' ? 'assistant' : 'user',
      parts: message.parts as unknown[],
      parentId: parent?.id ?? null,
      childIds: index < messages.length - 1 ? [messages[index + 1]!.id] : [],
      selectedChildId: index < messages.length - 1 ? messages[index + 1]!.id : null,
    }
  }

  payload.rootChildIds = [messages[0]!.id]
  payload.selectedRootChildId = messages[0]!.id
  return payload
}

async function createThreadWithConversation(messages: UIMessage[]) {
  const adapter = createTestAdapter()
  const project = await adapter.services.projects.create('Chat revisions', {
    ownerUserId: LOCAL_DEFAULT_USER.id,
  })
  const document = await adapter.services.documents.createForProject(project.id, 'chapter.md')
  if (!document) throw new Error('Expected a document')
  const thread = await adapter.services.chats.create(project.id, document.id)
  if (!thread) throw new Error('Expected a chat thread')

  const saved = await adapter.services.chats.savePayload(
    project.id,
    document.id,
    thread.id,
    buildLinearPayload(messages)
  )
  if (!saved) throw new Error('Expected chat messages to save')

  return {
    chats: adapter.services.chats,
    projectId: project.id,
    documentId: document.id,
    chatId: thread.id,
    thread: saved,
  }
}

const conversation: UIMessage[] = [
  { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Prompt' }] },
  { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'Reply' }] },
  { id: 'user-2', role: 'user', parts: [{ type: 'text', text: 'Follow-up' }] },
]

describe('ChatsService tree operations', () => {
  test('edits plain assistant text without removing later messages', async () => {
    const scope = await createThreadWithConversation(conversation)
    const updated = await scope.chats.updateMessageById(
      scope.projectId,
      scope.documentId,
      scope.chatId,
      'assistant-1',
      'Revised reply'
    )

    expect(updated?.messages).toEqual([
      conversation[0],
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'Revised reply' }] },
      conversation[2],
    ])
  })

  test('deletes one message or truncates from the selected message', async () => {
    const onlyScope = await createThreadWithConversation(conversation)
    const only = await onlyScope.chats.deleteMessagesById(
      onlyScope.projectId,
      onlyScope.documentId,
      onlyScope.chatId,
      'assistant-1',
      'only'
    )
    expect(only?.messages).toEqual([conversation[0], conversation[2]])

    const truncateScope = await createThreadWithConversation(conversation)
    const truncated = await truncateScope.chats.deleteMessagesById(
      truncateScope.projectId,
      truncateScope.documentId,
      truncateScope.chatId,
      'assistant-1',
      'from_here'
    )
    expect(truncated?.messages).toEqual([conversation[0]])
  })

  test('selectBranch switches the active path', async () => {
    const scope = await createThreadWithConversation(conversation)
    const forked = await scope.chats.forkRegenerationById(
      scope.projectId,
      scope.documentId,
      scope.chatId,
      'assistant-1'
    )
    if (!forked) throw new Error('Expected forked thread')

    const switched = await scope.chats.selectBranchById(
      scope.projectId,
      scope.documentId,
      scope.chatId,
      'assistant-1'
    )

    expect(switched?.messages.map((message) => (message as UIMessage).id)).toEqual([
      'user-1',
      'assistant-1',
      'user-2',
    ])
  })

  test('savePayload persists tree state', async () => {
    const scope = await createThreadWithConversation([conversation[0]!])
    expect(scope.thread.messages).toHaveLength(1)
    expect(scope.thread.tree.nodes['user-1']).toBeDefined()
  })
})
