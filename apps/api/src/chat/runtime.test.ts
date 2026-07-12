import { describe, expect, test } from 'bun:test'
import { LOCAL_DEFAULT_USER } from '../core/models/user.js'
import { createTestAdapter } from '../testing/factory.js'
import type { YjsRuntime } from '../yjs/runtime.js'
import { ChatRuntime } from './runtime.js'
import { createUserMessage } from './utils.js'

describe('ChatRuntime message revision guard', () => {
  test('rejects message changes while generation is active', async () => {
    const adapter = createTestAdapter()
    const project = await adapter.services.projects.create('Generation guard', {
      ownerUserId: LOCAL_DEFAULT_USER.id,
    })
    const document = await adapter.services.documents.createForProject(project.id, 'chapter.md')
    if (!document) throw new Error('Expected a document')
    const thread = await adapter.services.chats.create(project.id, document.id)
    if (!thread) throw new Error('Expected a chat thread')

    const runtime = new ChatRuntime(adapter.services, {} as YjsRuntime)
    const scope = { projectId: project.id, documentId: document.id, chatId: thread.id }
    await runtime.startGeneration({ ...scope, message: 'Keep this response running' })

    await expect(runtime.updateMessageById(scope, 'missing-message', 'Changed')).rejects.toThrow(
      'Stop the current response before editing or deleting messages.'
    )
    await expect(runtime.deleteMessagesById(scope, 'missing-message', 'only')).rejects.toThrow(
      'Stop the current response before editing or deleting messages.'
    )

    runtime.cancelGeneration(scope)
  })
})

describe('ChatRuntime continue generation', () => {
  test('starts generation without appending a user message when the thread ends with the author', async () => {
    const adapter = createTestAdapter()
    const project = await adapter.services.projects.create('Continue generation', {
      ownerUserId: LOCAL_DEFAULT_USER.id,
    })
    const document = await adapter.services.documents.createForProject(project.id, 'chapter.md')
    if (!document) throw new Error('Expected a document')
    const thread = await adapter.services.chats.create(project.id, document.id)
    if (!thread) throw new Error('Expected a chat thread')

    const userMessage = createUserMessage('Regenerate this reply')
    const saved = await adapter.services.chats.save(
      project.id,
      document.id,
      thread.id,
      [userMessage]
    )
    if (!saved) throw new Error('Expected saved chat thread')

    const runtime = new ChatRuntime(adapter.services, {} as YjsRuntime)
    const scope = { projectId: project.id, documentId: document.id, chatId: thread.id }
    await runtime.startGeneration({ ...scope, message: '' })

    const persisted = await adapter.services.chats.getById(project.id, document.id, thread.id)
    expect(persisted?.messages).toHaveLength(1)

    runtime.cancelGeneration(scope)
  })

  test('rejects continue generation for empty chats', async () => {
    const adapter = createTestAdapter()
    const project = await adapter.services.projects.create('Continue guard', {
      ownerUserId: LOCAL_DEFAULT_USER.id,
    })
    const document = await adapter.services.documents.createForProject(project.id, 'chapter.md')
    if (!document) throw new Error('Expected a document')
    const thread = await adapter.services.chats.create(project.id, document.id)
    if (!thread) throw new Error('Expected a chat thread')

    const runtime = new ChatRuntime(adapter.services, {} as YjsRuntime)
    const scope = { projectId: project.id, documentId: document.id, chatId: thread.id }

    await expect(runtime.startGeneration({ ...scope, message: '' })).rejects.toThrow(
      'Cannot continue an empty chat.'
    )
  })
})
