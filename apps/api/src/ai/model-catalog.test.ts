import { afterEach, describe, expect, test } from 'bun:test'
import { getSourceModelCatalog } from './model-catalog.js'

const MODELS_DEV_URL = 'https://models.dev/api.json'

const modelsDevPayload = {
  openrouter: {
    name: 'OpenRouter',
    npm: ['@openrouter/ai-sdk-provider'],
    api: 'https://openrouter.ai/api/v1',
    doc: 'https://openrouter.ai/docs',
    models: {
      'openrouter/fallback': {
        name: 'Fallback Model',
        release_date: '2025-01-01',
        modalities: {
          input: ['text'],
          output: ['text'],
        },
      },
    },
  },
  openai: {
    name: 'OpenAI',
    npm: ['@ai-sdk/openai'],
    api: 'https://api.openai.com/v1',
    doc: 'https://platform.openai.com/docs',
    models: {
      'text-embedding-3-small': {
        name: 'text-embedding-3-small',
        release_date: '2024-01-01',
        modalities: {
          input: ['text'],
          output: ['text'],
        },
        context_length: 8192,
        description: 'Embedding model',
      },
      'gpt-fallback': {
        name: 'GPT Fallback',
        release_date: '2025-01-01',
        modalities: {
          input: ['text'],
          output: ['text'],
        },
      },
    },
  },
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('getSourceModelCatalog', () => {
  test('queries OpenRouter provider catalog without API key before models.dev fallback', async () => {
    const calls: string[] = []

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      calls.push(url)

      if (url === MODELS_DEV_URL) {
        return jsonResponse(modelsDevPayload)
      }

      if (url.includes('openrouter.ai')) {
        return jsonResponse({
          data: [
            {
              id: 'openrouter/auto',
              name: 'OpenRouter Auto',
              created: 1735689600,
            },
          ],
        })
      }

      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const result = await getSourceModelCatalog(
      {
        providerId: 'openrouter',
        type: 'openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
      },
      '',
      'generation',
      {
        forceRefresh: true,
      }
    )

    expect(result.source).toBe('provider')
    expect(result.provider.models).toEqual([
      {
        id: 'openrouter/auto',
        name: 'OpenRouter Auto',
        releaseDate: '2025-01-01',
        contextLength: null,
        description: null,
      },
    ])
    expect(calls.some((url) => url.endsWith('/api/v1/models'))).toBe(true)
  })

  test('falls back to models.dev when OpenRouter provider catalog is unavailable', async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url === MODELS_DEV_URL) {
        return jsonResponse(modelsDevPayload)
      }

      if (url.includes('openrouter.ai')) {
        return new Response('not found', { status: 404 })
      }

      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const result = await getSourceModelCatalog(
      {
        providerId: 'openrouter',
        type: 'openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
      },
      '',
      'generation',
      {
        forceRefresh: true,
      }
    )

    expect(result.source).toBe('models.dev')
    expect(result.provider.models).toEqual([
      {
        id: 'openrouter/fallback',
        name: 'Fallback Model',
        releaseDate: '2025-01-01',
        contextLength: null,
        description: null,
      },
    ])
  })

  test('uses models.dev directly when non-openrouter source has no API key', async () => {
    const calls: string[] = []

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      calls.push(url)

      if (url === MODELS_DEV_URL) {
        return jsonResponse(modelsDevPayload)
      }

      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const result = await getSourceModelCatalog(
      {
        providerId: 'openai',
        type: 'openai',
        baseURL: 'https://api.openai.com/v1',
      },
      '',
      'generation',
      {
        forceRefresh: true,
      }
    )

    expect(result.source).toBe('models.dev')
    expect(calls.some((url) => url.includes('api.openai.com/v1/models'))).toBe(false)
  })

  test('filters embedding models from provider /models responses when requested', async () => {
    const calls: string[] = []

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      calls.push(url)

      if (url === MODELS_DEV_URL) {
        return jsonResponse(modelsDevPayload)
      }

      if (url === 'https://api.openai.com/v1/models') {
        return jsonResponse({
          data: [
            { id: 'gpt-5', created: 1735689600 },
            {
              id: 'text-embedding-3-small',
              created: 1735689600,
              context_length: 8192,
              description: 'Embedding model',
            },
          ],
        })
      }

      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const result = await getSourceModelCatalog(
      {
        providerId: 'openai',
        type: 'openai',
        baseURL: 'https://api.openai.com/v1',
      },
      'test-key',
      'embedding',
      {
        forceRefresh: true,
      }
    )

    expect(result.source).toBe('provider')
    expect(result.provider.models).toEqual([
      {
        id: 'text-embedding-3-small',
        name: null,
        releaseDate: '2025-01-01',
        contextLength: 8192,
        description: 'Embedding model',
      },
    ])
    expect(calls).toContain('https://api.openai.com/v1/models')
    expect(calls).not.toContain('https://api.openai.com/v1/embeddings/models')
  })

  test('filters embedding models from models.dev fallback when requested', async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url === MODELS_DEV_URL) {
        return jsonResponse(modelsDevPayload)
      }

      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const result = await getSourceModelCatalog(
      {
        providerId: 'openai',
        type: 'openai',
        baseURL: 'https://api.openai.com/v1',
      },
      '',
      'embedding',
      {
        forceRefresh: true,
      }
    )

    expect(result.source).toBe('models.dev')
    expect(result.provider.models).toEqual([
      {
        id: 'text-embedding-3-small',
        name: 'text-embedding-3-small',
        releaseDate: '2024-01-01',
        contextLength: 8192,
        description: 'Embedding model',
      },
    ])
  })

  test('fetches embedding models from OpenRouter /embeddings/models endpoint', async () => {
    const calls: string[] = []

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      calls.push(url)

      if (url === MODELS_DEV_URL) {
        return jsonResponse(modelsDevPayload)
      }

      if (url === 'https://openrouter.ai/api/v1/embeddings/models') {
        return jsonResponse({
          data: [
            {
              id: 'openai/text-embedding-3-small',
              context_length: 8192,
              description: 'Embedding model from /embeddings/models',
            },
          ],
        })
      }

      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const result = await getSourceModelCatalog(
      {
        providerId: 'openrouter',
        type: 'openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
      },
      'test-key',
      'embedding',
      {
        forceRefresh: true,
      }
    )

    expect(result.source).toBe('provider')
    expect(result.provider.models).toEqual([
      {
        id: 'openai/text-embedding-3-small',
        name: null,
        releaseDate: null,
        contextLength: 8192,
        description: 'Embedding model from /embeddings/models',
      },
    ])
    expect(calls).toContain('https://openrouter.ai/api/v1/embeddings/models')
  })

  test('falls back to generic /models when OpenRouter /embeddings/models fails', async () => {
    const calls: string[] = []

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      calls.push(url)

      if (url === MODELS_DEV_URL) {
        return jsonResponse(modelsDevPayload)
      }

      if (url === 'https://openrouter.ai/api/v1/embeddings/models') {
        return new Response('unavailable', { status: 503 })
      }

      if (url === 'https://openrouter.ai/api/v1/models') {
        return jsonResponse({
          data: [
            {
              id: 'openai/text-embedding-3-small',
              created: 1735689600,
              context_length: 8192,
              description: 'Fallback embedding model',
            },
          ],
        })
      }

      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const result = await getSourceModelCatalog(
      {
        providerId: 'openrouter',
        type: 'openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
      },
      'key-a',
      'embedding',
      {
        forceRefresh: true,
      }
    )

    expect(result.source).toBe('provider')
    expect(result.warning).toContain('Live embedding catalog unavailable')
    expect(result.provider.models).toEqual([
      {
        id: 'openai/text-embedding-3-small',
        name: null,
        releaseDate: '2025-01-01',
        contextLength: 8192,
        description: 'Fallback embedding model',
      },
    ])
    expect(calls).toContain('https://openrouter.ai/api/v1/embeddings/models')
    expect(calls).toContain('https://openrouter.ai/api/v1/models')
  })

  test('does not reuse cached provider catalogs across API keys', async () => {
    const calls: string[] = []

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      calls.push(url)

      if (url === MODELS_DEV_URL) {
        return jsonResponse(modelsDevPayload)
      }

      if (url === 'https://openrouter.ai/api/v1/embeddings/models') {
        const authHeader = init?.headers
        const token =
          authHeader && typeof authHeader === 'object' && 'authorization' in authHeader
            ? String(authHeader.authorization ?? '')
            : ''

        return jsonResponse({
          data: [
            {
              id: token.endsWith('key-b') ? 'embedding-b' : 'embedding-a',
              context_length: 1024,
              description: token.endsWith('key-b') ? 'key b model' : 'key a model',
            },
          ],
        })
      }

      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const first = await getSourceModelCatalog(
      {
        providerId: 'openrouter',
        type: 'openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
      },
      'key-a',
      'embedding',
      { forceRefresh: true }
    )

    const second = await getSourceModelCatalog(
      {
        providerId: 'openrouter',
        type: 'openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
      },
      'key-b',
      'embedding'
    )

    expect(first.provider.models[0]?.id).toBe('embedding-a')
    expect(second.provider.models[0]?.id).toBe('embedding-b')
  })
})
