import { describe, expect, test } from 'bun:test'
import { openRustStorage } from '../rust/engine.js'
import { RustDocumentEmbeddingMetadataStore } from '../rust/documentEmbeddingMetadataStore.adapter.js'
import { qdrantCollectionName } from '../../core/embeddings/documentEmbeddings.shared.js'
import { normalizeBaseURL } from '../../core/ai/provider-types.js'
import { QdrantDocumentEmbeddingsRepository } from './qdrantDocumentEmbeddings.adapter.js'
import { QdrantClient } from './qdrant.client.js'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('QdrantDocumentEmbeddingsRepository', () => {
  test('stores metadata in rust storage and searches vectors via qdrant', async () => {
    const engine = await openRustStorage(':memory:')

    try {
      await engine.documentsInsert(null, {
        id: 'doc_1',
        title: 'docs/a.md',
        type: 'manuscript',
        createdAt: 1,
        updatedAt: 1,
      })

      const calls: Array<{ url: string; method: string; body?: string }> = []
      const collections = new Set<string>()
      const collection = qdrantCollectionName(
        3,
        'lucentdocs',
        normalizeBaseURL('https://openrouter.ai/api/v1'),
        'test-model'
      )

      const fetchImpl: typeof fetch = (async (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        const method = init?.method ?? 'GET'
        const body = typeof init?.body === 'string' ? init.body : undefined
        calls.push({ url, method, body })

        if (url.endsWith(`/collections/${collection}`) && method === 'GET') {
          if (collections.has(collection)) return jsonResponse({ result: {} })
          return jsonResponse({ status: 'not found' }, 404)
        }

        if (url.endsWith(`/collections/${collection}`) && method === 'PUT') {
          collections.add(collection)
          return jsonResponse({ result: true })
        }

        if (url.endsWith(`/collections/${collection}/index`) && method === 'PUT') {
          return jsonResponse({ result: true })
        }

        if (url.includes(`/collections/${collection}/points?wait=true`) && method === 'PUT') {
          return jsonResponse({ result: { status: 'acknowledged' } })
        }

        if (url.includes(`/collections/${collection}/points/retrieve`) && method === 'POST') {
          const payload = JSON.parse(body ?? '{}') as { ids?: string[] }
          const ids = payload.ids ?? []
          return jsonResponse({
            result: ids.map((id) => ({ id })),
          })
        }

        if (url.includes(`/collections/${collection}/points/search`) && method === 'POST') {
          return jsonResponse({
            result: [
              {
                id: 'any',
                score: 0.91,
                payload: {
                  vectorKey: 'doc_1:https://openrouter.ai/api/v1:test-model:0',
                  documentId: 'doc_1',
                  baseUrl: 'https://openrouter.ai/api/v1',
                  model: 'test-model',
                },
              },
            ],
          })
        }

        if (url.includes('/points/delete') && method === 'POST') {
          return jsonResponse({ result: { status: 'acknowledged' } })
        }

        throw new Error(`Unexpected qdrant request ${method} ${url}`)
      }) as typeof fetch

      const repo = new QdrantDocumentEmbeddingsRepository(
        new RustDocumentEmbeddingMetadataStore(engine),
        new QdrantClient({
          endpoint: 'http://127.0.0.1:6333',
          collectionPrefix: 'lucentdocs',
          fetchImpl,
        })
      )

      const replacement = await repo.replaceEmbeddings({
        documentId: 'doc_1',
        providerConfigId: null,
        providerId: 'provider',
        type: 'openai',
        baseURL: 'https://openrouter.ai/api/v1',
        model: 'test-model',
        strategy: { type: 'whole_document', properties: {} },
        documentTimestamp: 100,
        contentHash: 'hash',
        chunks: [
          {
            ordinal: 0,
            start: 0,
            end: 12,
            text: 'hello world',
            embedding: [0.1, 0.2, 0.3],
          },
        ],
        createdAt: 100,
        updatedAt: 100,
      })

      expect(replacement.status).toBe('applied')

      const stored = await repo.findEmbeddings('doc_1', 'https://openrouter.ai/api/v1', 'test-model')
      expect(stored).toHaveLength(1)
      expect(stored[0]?.vectorKey).toBe('doc_1:https://openrouter.ai/api/v1:test-model:0')

      const matches = await repo.searchDocument({
        documentId: 'doc_1',
        baseURL: 'https://openrouter.ai/api/v1',
        model: 'test-model',
        queryEmbedding: [0.4, 0.5, 0.6],
        limit: 5,
      })

      expect(matches).toHaveLength(1)
      expect(matches[0]?.chunkText).toBe('hello world')
      expect(matches[0]?.documentId).toBe('doc_1')

      expect(calls.some((call) => call.url.includes('/points/search'))).toBe(true)
    } finally {
      await engine.close()
    }
  })
})
