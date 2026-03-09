import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { LOCAL_DEFAULT_USER, type User } from '../../core/models/user.js'
import type { AppContext } from '../index.js'
import { documentsRouter } from './documents.js'
import { createTestAdapter, type TestAdapter } from '../../testing/factory.js'
import { configureEmbeddingProvider, resetEmbeddingClient } from '../../embeddings/provider.js'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

function createCallerContext(options?: { user?: User; adapter?: TestAdapter }): AppContext {
  const adapter = options?.adapter ?? createTestAdapter()
  const currentUser = options?.user ?? LOCAL_DEFAULT_USER

  return {
    user: currentUser,
    services: adapter.services,
    authPort: {
      isEnabled: () => false,
      getUserById: async (userId: string) => (userId === currentUser.id ? currentUser : null),
      getUserByEmail: async (email: string) =>
        currentUser.email?.toLowerCase() === email.toLowerCase() ? currentUser : null,
      validateSession: async () => currentUser,
      login: async () => ({ success: false, error: 'not implemented' }),
      logout: async () => ({ success: true }),
      signup: async () => ({ success: false, error: 'not implemented' }),
    },
    yjsRuntime: {} as AppContext['yjsRuntime'],
    embeddingRuntime: {} as AppContext['embeddingRuntime'],
    chatRuntime: {} as AppContext['chatRuntime'],
    inlineRuntime: {} as AppContext['inlineRuntime'],
  }
}

async function initializeEmbeddingSelection(adapter: TestAdapter): Promise<void> {
  await adapter.services.aiSettings.initializeDefaults({
    env: {
      AI_PROVIDER: 'openrouter',
      AI_BASE_URL: OPENROUTER_BASE_URL,
      AI_MODEL: 'gpt-5',
      AI_API_KEY: 'test-key',
    },
  })
  configureEmbeddingProvider(adapter.services.aiSettings)
}

describe('documentsRouter', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    resetEmbeddingClient()
  })

  test('search returns project-linked matches for the active embedding model and groups snippets by document', async () => {
    const user: User = {
      id: 'owner_1',
      name: 'Owner One',
      email: 'owner1@example.com',
      role: 'user',
    }
    const adapter = createTestAdapter()
    await initializeEmbeddingSelection(adapter)

    const projectA = await adapter.services.projects.create('Story', { ownerUserId: user.id })
    const projectB = await adapter.services.projects.create('Shared', { ownerUserId: user.id })

    const sharedDoc = await adapter.services.documents.createForProject(projectA.id, 'shared.md')
    const localDoc = await adapter.services.documents.createForProject(projectA.id, 'local.md')
    const foreignDoc = await adapter.services.documents.createForProject(projectB.id, 'foreign.md')
    const mismatchedModelDoc = await adapter.services.documents.createForProject(
      projectA.id,
      'mismatch.md'
    )

    if (!sharedDoc || !localDoc || !foreignDoc || !mismatchedModelDoc) {
      throw new Error('Expected test documents to be created.')
    }

    await adapter.repositories.projectDocuments.insert({
      projectId: projectB.id,
      documentId: sharedDoc.id,
      addedAt: Date.now(),
    })

    const now = Date.now()
    await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: sharedDoc.id,
      providerConfigId: null,
      providerId: 'openrouter',
      type: 'openrouter',
      baseURL: OPENROUTER_BASE_URL,
      model: 'openai/text-embedding-3-small',
      strategy: {
        type: 'sliding_window',
        properties: {
          level: 'paragraph',
          windowSize: 2,
          stride: 1,
          minUnitChars: 40,
          maxUnitChars: 400,
        },
      },
      documentTimestamp: 100,
      contentHash: 'shared-hash',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 60,
          selectionFrom: 5,
          selectionTo: 39,
          text: 'Moonlight floods the silver forest and settles over the pines.',
          embedding: [0.1, 0.2, 0.3],
        },
        {
          ordinal: 1,
          start: 18,
          end: 72,
          selectionFrom: 42,
          selectionTo: 84,
          text: 'The silver forest glows again as moonlight brushes the pine needles.',
          embedding: [0.11, 0.2, 0.29],
        },
        {
          ordinal: 2,
          start: 110,
          end: 170,
          selectionFrom: 108,
          selectionTo: 152,
          text: 'Across the lake, moonlight catches on silver reeds and still water.',
          embedding: [0.12, 0.19, 0.28],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

    await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: localDoc.id,
      providerConfigId: null,
      providerId: 'openrouter',
      type: 'openrouter',
      baseURL: OPENROUTER_BASE_URL,
      model: 'openai/text-embedding-3-small',
      strategy: { type: 'whole_document', properties: {} },
      documentTimestamp: 101,
      contentHash: 'local-hash',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 58,
          text: 'The copper city wakes at dawn while market bells echo through the square.',
          embedding: [0.35, 0.35, 0.35],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

    await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: foreignDoc.id,
      providerConfigId: null,
      providerId: 'openrouter',
      type: 'openrouter',
      baseURL: OPENROUTER_BASE_URL,
      model: 'openai/text-embedding-3-small',
      strategy: { type: 'whole_document', properties: {} },
      documentTimestamp: 102,
      contentHash: 'foreign-hash',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 48,
          text: 'This remote archive should never appear in project A results.',
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

    await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: mismatchedModelDoc.id,
      providerConfigId: null,
      providerId: 'openrouter',
      type: 'openrouter',
      baseURL: OPENROUTER_BASE_URL,
      model: 'other-embedding-model',
      strategy: { type: 'whole_document', properties: {} },
      documentTimestamp: 103,
      contentHash: 'mismatch-hash',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 54,
          text: 'Wrong model rows should be ignored even when the text looks relevant.',
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

    const caller = documentsRouter.createCaller(
      createCallerContext({
        user,
        adapter,
      })
    )

    const results = await caller.search({
      projectId: projectA.id,
      query: 'silver moonlight forest',
      limit: 5,
    })

    expect(results.map((result) => result.id)).toEqual([sharedDoc.id, localDoc.id])
    expect(results[0]?.matchType).toBe('snippet')
    expect(results[0]?.snippets).toHaveLength(3)
    expect(results[0]?.snippets[0]?.text.toLowerCase()).toContain('moonlight')
    expect(results[0]?.snippets[0]).toMatchObject({ start: 5, end: 39 })
    expect(results[1]?.matchType).toBe('whole_document')
    expect(results[1]?.snippets).toEqual([])
    expect(results.some((result) => result.id === foreignDoc.id)).toBe(false)
    expect(results.some((result) => result.id === mismatchedModelDoc.id)).toBe(false)
  })

  test('get returns documents linked to the project even when they are shared across projects', async () => {
    const user: User = {
      id: 'owner_1',
      name: 'Owner One',
      email: 'owner1@example.com',
      role: 'user',
    }
    const adapter = createTestAdapter()

    const projectA = await adapter.services.projects.create('Story', { ownerUserId: user.id })
    const projectB = await adapter.services.projects.create('Shared', { ownerUserId: user.id })
    const document = await adapter.services.documents.createForProject(projectA.id, 'shared.md')

    if (!document) {
      throw new Error('Expected a shared document to be created.')
    }

    await adapter.repositories.projectDocuments.insert({
      projectId: projectB.id,
      documentId: document.id,
      addedAt: Date.now(),
    })

    const caller = documentsRouter.createCaller(
      createCallerContext({
        user,
        adapter,
      })
    )

    const result = await caller.get({
      projectId: projectB.id,
      id: document.id,
    })

    expect(result.id).toBe(document.id)
    expect(result.title).toBe('shared.md')
  })
})
