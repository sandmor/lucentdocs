import { describe, expect, test } from 'bun:test'
import { createTestAdapter } from '../../testing/factory.js'

async function createEmbeddingProviderPair() {
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

  const providers = await adapter.services.embeddingModelSelection.getAvailableProviders()
  const secondary = providers.find((provider) => provider.model === 'openai/text-embedding-ada-002')

  if (!secondary) {
    throw new Error('Expected a secondary embedding provider.')
  }

  return { adapter, primary, secondary }
}

describe('EmbeddingModelSelectionService', () => {
  test('uses document-owned selection for shared documents', async () => {
    const { adapter, primary, secondary } = await createEmbeddingProviderPair()

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

    await adapter.services.embeddingModelSelection.updateProjectStrategy(projectA.id, secondary.id)

    const projectScoped = await adapter.services.embeddingModelSelection.resolveForDocument(
      document.id,
      projectA.id
    )
    const unscoped = await adapter.services.embeddingModelSelection.resolveForDocument(document.id)
    const batchScoped = await adapter.services.embeddingModelSelection.resolveForProjectDocuments(
      projectA.id,
      [document.id]
    )

    expect(projectScoped?.scopeType).toBe('global')
    expect(projectScoped?.providerConfigId).toBe(primary.id)
    expect(unscoped?.scopeType).toBe('global')
    expect(batchScoped.get(document.id)?.scopeType).toBe('global')
    expect(batchScoped.get(document.id)?.providerConfigId).toBe(primary.id)

    await adapter.services.embeddingModelSelection.updateDocumentStrategy(
      document.id,
      secondary.id,
      projectA.id
    )

    const documentScoped = await adapter.services.embeddingModelSelection.resolveForDocument(
      document.id,
      projectA.id
    )

    expect(documentScoped?.scopeType).toBe('document')
    expect(documentScoped?.providerConfigId).toBe(secondary.id)
  })

  test('resolveForDocuments returns per-document selections in batch', async () => {
    const { adapter, primary, secondary } = await createEmbeddingProviderPair()

    const project = await adapter.services.projects.create('Batch', {
      ownerUserId: 'user_1',
    })
    const docA = await adapter.services.documents.createForProject(project.id, 'a.md')
    const docB = await adapter.services.documents.createForProject(project.id, 'b.md')

    if (!docA || !docB) {
      throw new Error('Expected project documents to be created.')
    }

    await adapter.services.embeddingModelSelection.updateDocumentStrategy(docB.id, secondary.id)

    const resolved = await adapter.services.embeddingModelSelection.resolveForDocuments([
      docA.id,
      docB.id,
    ])

    expect(resolved.get(docA.id)?.providerConfigId).toBe(primary.id)
    expect(resolved.get(docB.id)?.providerConfigId).toBe(secondary.id)
  })
})
