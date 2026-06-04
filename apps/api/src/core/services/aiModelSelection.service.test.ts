import { describe, expect, test } from 'bun:test'
import { createTestAdapter } from '../../testing/factory.js'

async function createGenerationProviderPair() {
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
  })

  const providers = await adapter.services.aiModelSelection.getAvailableGenerationProviders()
  const secondary = providers.find((provider) => provider.model === 'openai/gpt-4.1-mini')

  if (!secondary) {
    throw new Error('Expected a secondary generation provider.')
  }

  return { adapter, primary, secondary }
}

describe('AiModelSelectionService', () => {
  test('uses the current project when resolving a shared document', async () => {
    const { adapter, secondary } = await createGenerationProviderPair()

    const projectA = await adapter.services.projects.create('Story', {
      ownerUserId: 'user_1',
    })
    const projectB = await adapter.services.projects.create('Shared board', {
      ownerUserId: 'user_2',
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

    await adapter.services.aiModelSelection.updateProjectStrategy(projectA.id, secondary.id)

    const projectScoped = await adapter.services.aiModelSelection.resolveForDocument(
      document.id,
      projectA.id
    )
    const unscoped = await adapter.services.aiModelSelection.resolveForDocument(document.id)

    expect(projectScoped?.scopeType).toBe('project')
    expect(projectScoped?.scopeId).toBe(projectA.id)
    expect(projectScoped?.providerConfigId).toBe(secondary.id)
    expect(unscoped?.scopeType).toBe('global')
  })

  test('normalizes stale direct selections in snapshots', async () => {
    const adapter = createTestAdapter()
    await adapter.services.aiSettings.initializeDefaults()

    await adapter.repositories.aiModelSelection.upsert({
      usage: 'generation',
      scopeType: 'user',
      scopeId: 'user_1',
      providerConfigId: 'missing-provider',
      updatedAt: Date.now(),
    })

    const snapshot = await adapter.services.aiModelSelection.getUserSnapshot('user_1')

    expect(snapshot.user?.providerConfigId).toBeNull()
    expect(snapshot.resolved.scopeType).toBe('global')
  })
})
