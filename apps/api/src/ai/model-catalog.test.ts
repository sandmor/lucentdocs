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
      {
        forceRefresh: true,
      }
    )

    expect(result.source).toBe('models.dev')
    expect(calls.some((url) => url.includes('api.openai.com/v1/models'))).toBe(false)
  })
})
