import { describe, expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import { LOCAL_DEFAULT_USER } from '../models/user.js'
import { createTestAdapter } from '../../testing/factory.js'

async function createThreadWithMessages(messages: UIMessage[]) {
  const adapter = createTestAdapter()
  const project = await adapter.services.projects.create('Chat revisions', {
    ownerUserId: LOCAL_DEFAULT_USER.id,
  })
  const document = await adapter.services.documents.createForProject(project.id, 'chapter.md')
  if (!document) throw new Error('Expected a document')
  const thread = await adapter.services.chats.create(project.id, document.id)
  if (!thread) throw new Error('Expected a chat thread')
  const saved = await adapter.services.chats.save(project.id, document.id, thread.id, messages)
  if (!saved) throw new Error('Expected chat messages to save')

  return { chats: adapter.services.chats, projectId: project.id, documentId: document.id, thread }
}

const conversation: UIMessage[] = [
  { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Prompt' }] },
  { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'Reply' }] },
  { id: 'user-2', role: 'user', parts: [{ type: 'text', text: 'Follow-up' }] },
]

describe('ChatsService message revisions', () => {
  test('edits plain assistant text without removing later messages', async () => {
    const scope = await createThreadWithMessages(conversation)
    const updated = await scope.chats.updateMessageById(
      scope.projectId,
      scope.documentId,
      scope.thread.id,
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
    const onlyScope = await createThreadWithMessages(conversation)
    const only = await onlyScope.chats.deleteMessagesById(
      onlyScope.projectId,
      onlyScope.documentId,
      onlyScope.thread.id,
      'assistant-1',
      'only'
    )
    expect(only?.messages).toEqual([conversation[0], conversation[2]])

    const truncateScope = await createThreadWithMessages(conversation)
    const truncated = await truncateScope.chats.deleteMessagesById(
      truncateScope.projectId,
      truncateScope.documentId,
      truncateScope.thread.id,
      'assistant-1',
      'from_here'
    )
    expect(truncated?.messages).toEqual([conversation[0]])
  })
})
