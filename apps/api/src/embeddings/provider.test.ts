import { afterEach, describe, expect, test } from 'bun:test'
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

function configureWithMockFetch(fetchImpl: () => Promise<Response>): void {
  configureEmbeddingProvider(createAiSettingsServiceMock(), {
    fetchImpl: fetchImpl as unknown as typeof fetch,
  })
}

describe('EmbeddingProvider', () => {
  afterEach(() => {
    resetEmbeddingClient()
  })

  test('rejects empty embedding vectors from the provider', async () => {
    configureWithMockFetch(async () => {
      return new Response(
        JSON.stringify({
          data: [{ embedding: [] }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    })

    const provider = await getEmbeddingProvider()

    await expect(provider.embed(['hello'])).rejects.toThrow('Embedding response entry 0 is empty.')
  })

  test('rejects inconsistent embedding dimensions within the same batch', async () => {
    configureWithMockFetch(async () => {
      return new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5] }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    })

    const provider = await getEmbeddingProvider()

    await expect(provider.embed(['a', 'b'])).rejects.toThrow(
      'Embedding response entry 1 has 2 dimensions, expected 3.'
    )
  })

  test('reset clears fetch override and uses global fetch afterwards', async () => {
    configureWithMockFetch(async () => {
      return new Response(
        JSON.stringify({
          data: [{ embedding: [0.9, 0.8, 0.7] }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    })

    const firstProvider = await getEmbeddingProvider()
    const first = await firstProvider.embed(['alpha'])
    expect(first[0]?.embedding).toEqual([0.9, 0.8, 0.7])

    const originalFetch = globalThis.fetch
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

    try {
      resetEmbeddingClient()
      const secondProvider = await getEmbeddingProvider()
      const second = await secondProvider.embed(['beta'])
      expect(second[0]?.embedding).toEqual([0.1, 0.2, 0.3])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
