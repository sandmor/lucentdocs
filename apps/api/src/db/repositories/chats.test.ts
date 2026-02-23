import { describe, expect, test } from 'bun:test'
import { createProject } from './projects.js'
import { createDocumentForProject } from './documents.js'
import {
  createDocumentChat,
  deleteDocumentChat,
  getDocumentChatById,
  listDocumentChats,
  saveDocumentChat,
} from './chats.js'

describe('chat repository', () => {
  test('creates, saves, lists, and reads chat threads', async () => {
    const project = await createProject('chat-threads-project')
    const document = await createDocumentForProject(project.id, 'notes/chat.md')
    expect(document).not.toBeNull()

    const created = await createDocumentChat(project.id, document!.id)
    expect(created).not.toBeNull()

    const messages = [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello there' }] },
      { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
    ]
    const saved = await saveDocumentChat(project.id, document!.id, created!.id, messages)
    expect(saved).not.toBeNull()
    expect(saved!.messages).toEqual(messages)

    const byId = await getDocumentChatById(project.id, document!.id, created!.id)
    expect(byId).not.toBeNull()
    expect(byId!.messages).toEqual(messages)
    expect(byId!.title).toBe('hello there')

    const listed = await listDocumentChats(project.id, document!.id)
    expect(listed.length).toBe(1)
    expect(listed[0]!.id).toBe(created!.id)
    expect(listed[0]!.messageCount).toBe(2)
  })

  test('deletes a chat thread', async () => {
    const project = await createProject('chat-thread-delete-project')
    const document = await createDocumentForProject(project.id, 'notes/delete.md')
    expect(document).not.toBeNull()

    const created = await createDocumentChat(project.id, document!.id)
    expect(created).not.toBeNull()

    const deleted = await deleteDocumentChat(project.id, document!.id, created!.id)
    expect(deleted).toBe(true)

    const loaded = await getDocumentChatById(project.id, document!.id, created!.id)
    expect(loaded).toBeNull()
  })
})
