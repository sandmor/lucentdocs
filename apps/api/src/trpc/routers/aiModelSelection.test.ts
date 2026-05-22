import { describe, expect, test } from 'bun:test'
import { LOCAL_DEFAULT_USER, type User } from '../../core/models/user.js'
import type { AppContext } from '../index.js'
import { aiModelSelectionRouter } from './aiModelSelection.js'
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

describe('aiModelSelectionRouter', () => {
  test('resolves document settings against the active project for shared documents', async () => {
    const owner: User = {
      id: 'owner_1',
      name: 'Owner One',
      email: 'owner1@example.com',
      role: 'user',
    }
    const adapter = createTestAdapter()
    await adapter.services.aiSettings.initializeDefaults()

    const snapshot = await adapter.services.aiSettings.getSnapshot()
    const primary = snapshot.generationProviders[0]

    if (!primary) {
      throw new Error('Expected a default generation provider.')
    }

    await adapter.services.aiSettings.updateSettings({
      usage: 'generation',
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
          model: 'openai/gpt-4.1-mini',
          apiKeyId: null,
        },
      ],
      activeProviderId: primary.id,
    })

    const provider = (
      await adapter.services.aiModelSelection.getAvailableGenerationProviders()
    ).find((entry) => entry.model === 'openai/gpt-4.1-mini')

    if (!provider) {
      throw new Error('Expected a secondary generation provider.')
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

    const caller = aiModelSelectionRouter.createCaller(
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

    expect(snapshotForDocument.resolved.scopeType).toBe('project')
    expect(snapshotForDocument.resolved.scopeId).toBe(projectA.id)
    expect(snapshotForDocument.resolved.providerConfigId).toBe(provider.id)
  })
})
