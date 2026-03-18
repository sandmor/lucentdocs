import { describe, expect, test } from 'bun:test'
import { createConnection } from '../sqlite/connection.js'
import { SqliteDocumentEmbeddingMetadataStore } from '../sqlite/documentEmbeddingMetadataStore.adapter.js'
import { QdrantDocumentEmbeddingsRepository } from './qdrantDocumentEmbeddings.adapter.js'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('QdrantDocumentEmbeddingsRepository', () => {
  test('stores metadata in sqlite and searches vectors via qdrant', async () => {
    const connection = createConnection(':memory:')

    connection.run(
      'INSERT INTO documents (id, title, type, metadata, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      ['doc_1', 'docs/a.md', 'manuscript', null, 1, 1]
    )

    const calls: Array<{ url: string; method: string; body?: string }> = []
    const collections = new Set<string>()

    const fetchImpl: typeof fetch = (async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? init.body : undefined
      calls.push({ url, method, body })

      if (url.endsWith('/collections/lucentdocs_d3') && method === 'GET') {
        if (collections.has('lucentdocs_d3')) return jsonResponse({ result: {} })
        return jsonResponse({ status: 'not found' }, 404)
      }

      if (url.endsWith('/collections/lucentdocs_d3') && method === 'PUT') {
        collections.add('lucentdocs_d3')
        return jsonResponse({ result: true })
      }

      if (url.includes('/collections/lucentdocs_d3/points?wait=true') && method === 'PUT') {
        return jsonResponse({ result: { status: 'acknowledged' } })
      }

      if (url.includes('/collections/lucentdocs_d3/points/retrieve') && method === 'POST') {
        const payload = JSON.parse(body ?? '{}') as { ids?: string[] }
        const ids = payload.ids ?? []
        return jsonResponse({
          result: ids.map((id) => ({ id })),
        })
      }

      if (url.includes('/collections/lucentdocs_d3/points/search') && method === 'POST') {
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
      new SqliteDocumentEmbeddingMetadataStore(connection),
      {
        endpoint: 'http://127.0.0.1:6333',
        collectionPrefix: 'lucentdocs',
        fetchImpl,
      }
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

    connection.close()
  })
})
