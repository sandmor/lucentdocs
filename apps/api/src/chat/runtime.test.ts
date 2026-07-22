import { describe, expect, test } from 'bun:test'
import { LOCAL_DEFAULT_USER } from '../core/models/user.js'
import { createTestAdapter } from '../testing/factory.js'
import type { YjsRuntime } from '../yjs/runtime.js'
import { ChatRuntime } from './runtime.js'
import { appendUserMessage } from './tree.js'
import { createEmptyChatThreadPayload } from '../core/services/chat-thread-payload.js'

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
    await expect(runtime.selectBranch(scope, 'missing-message')).rejects.toThrow(
      'Stop the current response before editing or deleting messages.'
    )
    await expect(runtime.regenerateFromMessage(scope, 'missing-message')).rejects.toThrow(
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

    let payload = createEmptyChatThreadPayload()
    const appended = appendUserMessage(payload, 'Regenerate this reply')
    payload = appended.payload
    const saved = await adapter.services.chats.savePayload(
      project.id,
      document.id,
      thread.id,
      payload
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

describe('ChatRuntime generation completion', () => {
  test('shares an active run across document scopes and late subscribers', async () => {
    const adapter = createTestAdapter()
    const project = await adapter.services.projects.create('Shared live run', {
      ownerUserId: LOCAL_DEFAULT_USER.id,
    })
    const origin = await adapter.services.documents.createForProject(project.id, 'origin.md')
    const destination = await adapter.services.documents.createForProject(project.id, 'destination.md')
    if (!origin || !destination) throw new Error('Expected documents')
    const thread = await adapter.services.chats.create(project.id, origin.id)
    if (!thread) throw new Error('Expected a chat thread')

    const runtime = new ChatRuntime(adapter.services, {} as YjsRuntime)
    const originScope = { projectId: project.id, documentId: origin.id, chatId: thread.id }
    const destinationScope = { projectId: project.id, documentId: destination.id, chatId: thread.id }
    const previousDelay = process.env.LUCENTDOCS_TEST_CHAT_DELAY_MS
    process.env.LUCENTDOCS_TEST_CHAT_DELAY_MS = '100'

    try {
      await runtime.startGeneration({ ...originScope, message: 'Keep streaming' })
      const lateEvents: Array<{ generating: boolean; generationId: string | null }> = []
      const unsubscribe = await runtime.subscribe(destinationScope, (event) => {
        if (event.type === 'snapshot') {
          lateEvents.push({ generating: event.generating, generationId: event.generationId })
        }
      })

      expect(runtime.isGenerating(destinationScope)).toBe(true)
      expect((await runtime.getObserveState(destinationScope)).generating).toBe(true)
      expect(lateEvents.some((event) => event.generating && event.generationId)).toBe(true)

      unsubscribe()
      runtime.cancelGeneration(destinationScope)
    } finally {
      if (previousDelay === undefined) delete process.env.LUCENTDOCS_TEST_CHAT_DELAY_MS
      else process.env.LUCENTDOCS_TEST_CHAT_DELAY_MS = previousDelay
    }
  })

  test('completes test-mode generation and clears active state', async () => {
    const adapter = createTestAdapter()
    const project = await adapter.services.projects.create('Generation complete', {
      ownerUserId: LOCAL_DEFAULT_USER.id,
    })
    const document = await adapter.services.documents.createForProject(project.id, 'chapter.md')
    if (!document) throw new Error('Expected a document')
    const thread = await adapter.services.chats.create(project.id, document.id)
    if (!thread) throw new Error('Expected a chat thread')

    const runtime = new ChatRuntime(adapter.services, {} as YjsRuntime)
    const scope = { projectId: project.id, documentId: document.id, chatId: thread.id }
    await runtime.startGeneration({ ...scope, message: 'Complete this response' })

    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (!runtime.isGenerating(scope)) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    expect(runtime.isGenerating(scope)).toBe(false)

    const persisted = await adapter.services.chats.getById(project.id, document.id, thread.id)
    expect(persisted?.messages).toHaveLength(2)
  })
})

describe('ChatRuntime branch selection', () => {
  test('selectBranch publishes updated active path', async () => {
    const adapter = createTestAdapter()
    const project = await adapter.services.projects.create('Branch select', {
      ownerUserId: LOCAL_DEFAULT_USER.id,
    })
    const document = await adapter.services.documents.createForProject(project.id, 'chapter.md')
    if (!document) throw new Error('Expected a document')
    const thread = await adapter.services.chats.create(project.id, document.id)
    if (!thread) throw new Error('Expected a chat thread')

    let payload = createEmptyChatThreadPayload()
    const user = appendUserMessage(payload, 'Hello')
    payload = user.payload
    await adapter.services.chats.savePayload(project.id, document.id, thread.id, payload)

    const forked = await adapter.services.chats.forkRegenerationById(
      project.id,
      document.id,
      thread.id,
      user.nodeId
    )
    if (!forked) throw new Error('Expected forked thread')

    const runtime = new ChatRuntime(adapter.services, {} as YjsRuntime)
    const scope = { projectId: project.id, documentId: document.id, chatId: thread.id }
    const updated = await runtime.selectBranch(scope, user.nodeId)

    expect(updated.messages).toHaveLength(1)
    expect(updated.messages[0]).toMatchObject({ role: 'user', parts: [{ text: 'Hello' }] })
  })
})

describe('ChatRuntime edit and generate', () => {
  test('editMessageAndGenerate continues from an edited leaf user message', async () => {
    const adapter = createTestAdapter()
    const project = await adapter.services.projects.create('Edit leaf generate', {
      ownerUserId: LOCAL_DEFAULT_USER.id,
    })
    const document = await adapter.services.documents.createForProject(project.id, 'chapter.md')
    if (!document) throw new Error('Expected a document')
    const thread = await adapter.services.chats.create(project.id, document.id)
    if (!thread) throw new Error('Expected a chat thread')

    let payload = createEmptyChatThreadPayload()
    const appended = appendUserMessage(payload, 'Original prompt')
    payload = appended.payload
    await adapter.services.chats.savePayload(project.id, document.id, thread.id, payload)

    const runtime = new ChatRuntime(adapter.services, {} as YjsRuntime)
    const scope = { projectId: project.id, documentId: document.id, chatId: thread.id }
    await runtime.editMessageAndGenerate(scope, appended.nodeId, 'Edited prompt')

    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (!runtime.isGenerating(scope)) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    const persisted = await adapter.services.chats.getById(project.id, document.id, thread.id)
    expect(persisted?.messages).toHaveLength(2)
    expect(persisted?.messages[0]).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: 'Edited prompt' }],
    })
  })
})
