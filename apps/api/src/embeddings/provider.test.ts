import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { AiSettingsService } from '../core/services/aiSettings.service.js'
import {
  configureEmbeddingProvider,
  getEmbeddingProvider,
  resetEmbeddingClient,
} from './provider.js'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

function createAiSettingsServiceMock(): AiSettingsService {
  return {
    initializeDefaults: async () => {},
    getSnapshot: async () => ({
      generationProviders: [],
      activeGenerationProviderId: null,
      embeddingProviders: [],
      activeEmbeddingProviderId: null,
      apiKeys: [],
    }),
    updateSettings: async () => {
      throw new Error('not implemented')
    },
    createApiKey: async () => {
      throw new Error('not implemented')
    },
    updateApiKey: async () => {
      throw new Error('not implemented')
    },
    deleteApiKey: async () => {
      throw new Error('not implemented')
    },
    resolveRuntimeSelection: async () => ({
      providerConfigId: 'embedding-provider',
      providerId: 'openrouter',
      type: 'openrouter',
      baseURL: OPENROUTER_BASE_URL,
      model: 'openai/text-embedding-3-small',
      apiKey: 'test-key',
    }),
    resolveApiKeyForBaseURL: async () => null,
    resolveApiKeyById: async () => null,
  }
}

describe('EmbeddingProvider', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    configureEmbeddingProvider(createAiSettingsServiceMock())
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    resetEmbeddingClient()
  })

  test('rejects empty embedding vectors from the provider', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          data: [{ embedding: [] }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    }) as unknown as typeof fetch

    const provider = await getEmbeddingProvider()

    await expect(provider.embed(['hello'])).rejects.toThrow('Embedding response entry 0 is empty.')
  })

  test('rejects inconsistent embedding dimensions within the same batch', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5] }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    }) as unknown as typeof fetch

    const provider = await getEmbeddingProvider()

    await expect(provider.embed(['a', 'b'])).rejects.toThrow(
      'Embedding response entry 1 has 2 dimensions, expected 3.'
    )
  })
})
