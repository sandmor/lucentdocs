import { describe, expect, test } from 'bun:test'
import { LOCAL_DEFAULT_USER, type User } from '../../core/models/user.js'
import type { AppContext } from '../index.js'
import { embeddingModelSelectionRouter } from './embeddingModelSelection.js'
import { createTestAdapter, type TestAdapter } from '../../testing/factory.js'

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
    chatRuntime: {} as AppContext['chatRuntime'],
    inlineRuntime: {} as AppContext['inlineRuntime'],
    documentImportRuntime: {
      enqueueImport: async () => ({ jobId: 'test-job', queued: 0, queuedJobs: 0 }),
    },
  }
}

describe('embeddingModelSelectionRouter', () => {
  test('resolves shared document settings through document/global embedding policy', async () => {
    const owner: User = {
      id: 'owner_1',
      name: 'Owner One',
      email: 'owner1@example.com',
      role: 'user',
    }
    const adapter = createTestAdapter()
    await adapter.services.aiSettings.initializeDefaults()

    const snapshot = await adapter.services.aiSettings.getSnapshot()
    const primary = snapshot.embeddingProviders[0]

    if (!primary) {
      throw new Error('Expected a default embedding provider.')
    }

    await adapter.services.aiSettings.updateSettings({
      usage: 'embedding',
      providers: [
        {
          id: primary.id,
          name: primary.name ?? undefined,
          providerId: primary.providerId,
          type: primary.type,
          baseURL: primary.baseURL,
          model: primary.model,
          apiKeyId: primary.apiKeyId,
        },
        {
          providerId: 'openrouter',
          type: 'openrouter',
          baseURL: 'https://openrouter.ai/api/v1',
          model: 'openai/text-embedding-ada-002',
          apiKeyId: null,
        },
      ],
    })

    const provider = (await adapter.services.embeddingModelSelection.getAvailableProviders()).find(
      (entry) => entry.model === 'openai/text-embedding-ada-002'
    )

    if (!provider) {
      throw new Error('Expected a secondary embedding provider.')
    }

    const projectA = await adapter.services.projects.create('Story', {
      ownerUserId: owner.id,
    })
    const projectB = await adapter.services.projects.create('Shared', {
      ownerUserId: 'owner_2',
    })
    const document = await adapter.services.documents.createForProject(projectA.id, 'shared.md')

    if (!document) {
      throw new Error('Expected a project document to be created.')
    }

    await adapter.repositories.projectDocuments.insert({
      projectId: projectB.id,
      documentId: document.id,
      addedAt: Date.now(),
    })

    const caller = embeddingModelSelectionRouter.createCaller(
      createCallerContext({
        user: owner,
        adapter,
      })
    )

    await caller.updateProject({
      projectId: projectA.id,
      providerConfigId: provider.id,
    })

    const snapshotForDocument = await caller.getDocument({
      projectId: projectA.id,
      id: document.id,
    })

    expect(snapshotForDocument.resolved.scopeType).toBe('global')
    expect(snapshotForDocument.resolved.providerConfigId).toBe(primary.id)

    await caller.updateDocument({
      projectId: projectA.id,
      id: document.id,
      providerConfigId: provider.id,
    })

    const documentOverride = await caller.getDocument({
      projectId: projectA.id,
      id: document.id,
    })

    expect(documentOverride.resolved.scopeType).toBe('document')
    expect(documentOverride.resolved.providerConfigId).toBe(provider.id)
  })
})
