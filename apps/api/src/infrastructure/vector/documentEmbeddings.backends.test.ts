import { describe, expect, test } from 'bun:test'
import type { SqliteConnection } from '../sqlite/connection.js'
import type { DocumentEmbeddingsRepositoryPort } from '../../core/ports/documentEmbeddings.port.js'
import { createConnection } from '../sqlite/connection.js'
import { DocumentEmbeddingsRepository } from '../sqlite/documentEmbeddings.adapter.js'
import { SqliteDocumentEmbeddingMetadataStore } from '../sqlite/documentEmbeddingMetadataStore.adapter.js'
import { QdrantDocumentEmbeddingsRepository } from './qdrantDocumentEmbeddings.adapter.js'

type BackendKind = 'sqlite' | 'qdrant'

interface VectorPoint {
  id: string
  vector: number[]
  payload: Record<string, unknown>
}

function asUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0

  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }

  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function createQdrantFetchMock(): typeof fetch {
  const collections = new Map<string, Map<string, VectorPoint>>()

  return (async (input, init) => {
    const url = asUrl(input)
    const method = init?.method ?? 'GET'

    const collectionMatch = url.match(/\/collections\/([^/?]+)/)
    const collection = collectionMatch?.[1]

    if (!collection) {
      throw new Error(`Unexpected qdrant request ${method} ${url}`)
    }

    if (url.endsWith(`/collections/${collection}`) && method === 'GET') {
      if (collections.has(collection)) {
        return new Response(JSON.stringify({ result: {} }), { status: 200 })
      }
      return new Response(JSON.stringify({ status: 'not found' }), { status: 404 })
    }

    if (url.endsWith(`/collections/${collection}`) && method === 'PUT') {
      if (!collections.has(collection)) {
        collections.set(collection, new Map())
      }
      return new Response(JSON.stringify({ result: true }), { status: 200 })
    }

    if (url.includes(`/collections/${collection}/points?wait=true`) && method === 'PUT') {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        points?: VectorPoint[]
      }
      const points = body.points ?? []
      const bucket = collections.get(collection)
      if (!bucket) {
        return new Response(JSON.stringify({ status: 'not found' }), { status: 404 })
      }
      for (const point of points) {
        bucket.set(point.id, point)
      }
      return new Response(JSON.stringify({ result: { status: 'acknowledged' } }), { status: 200 })
    }

    if (url.includes(`/collections/${collection}/points/delete?wait=true`) && method === 'POST') {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        points?: string[]
      }
      const ids = body.points ?? []
      const bucket = collections.get(collection)
      if (!bucket) {
        return new Response(JSON.stringify({ status: 'not found' }), { status: 404 })
      }
      for (const id of ids) {
        bucket.delete(id)
      }
      return new Response(JSON.stringify({ result: { status: 'acknowledged' } }), { status: 200 })
    }

    if (url.includes(`/collections/${collection}/points/retrieve`) && method === 'POST') {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        ids?: string[]
      }
      const ids = body.ids ?? []
      const bucket = collections.get(collection)
      if (!bucket) {
        return new Response(JSON.stringify({ status: 'not found' }), { status: 404 })
      }

      return new Response(
        JSON.stringify({
          result: ids.filter((id) => bucket.has(id)).map((id) => ({ id })),
        }),
        { status: 200 }
      )
    }

    if (url.endsWith(`/collections/${collection}/points/search`) && method === 'POST') {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        vector?: number[]
        limit?: number
        filter?: { must?: Array<{ key?: string; match?: { value?: unknown } }> }
      }

      const query = body.vector ?? []
      const limit = body.limit ?? 10
      const must = body.filter?.must ?? []
      const bucket = collections.get(collection)
      if (!bucket) {
        return new Response(JSON.stringify({ status: 'not found' }), { status: 404 })
      }

      const matches = [...bucket.values()]
        .filter((point) =>
          must.every((rule) => {
            const key = rule.key
            if (!key) return true
            const payloadValue = point.payload[key]
            const expected = rule.match?.value
            if (Array.isArray(payloadValue)) {
              return payloadValue.includes(expected)
            }
            return payloadValue === expected
          })
        )
        .map((point) => ({
          id: point.id,
          payload: point.payload,
          score: cosineSimilarity(point.vector, query),
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, limit)

      return new Response(JSON.stringify({ result: matches }), { status: 200 })
    }

    throw new Error(`Unexpected qdrant request ${method} ${url}`)
  }) as typeof fetch
}

function insertDocument(connection: SqliteConnection, id: string, title: string): void {
  connection.run(
    'INSERT INTO documents (id, title, type, metadata, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    [id, title, 'manuscript', null, 1, 1]
  )
}

function linkDocumentToProject(
  connection: SqliteConnection,
  projectId: string,
  documentId: string
): void {
  connection.run(
    'INSERT INTO project_documents (projectId, documentId, addedAt) VALUES (?, ?, ?)',
    [projectId, documentId, 1]
  )
}

function insertProject(connection: SqliteConnection, projectId: string): void {
  connection.run(
    'INSERT INTO projects (id, title, ownerUserId, metadata, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    [projectId, `Project ${projectId}`, 'user_1', null, 1, 1]
  )
}

function createRepository(
  backend: BackendKind,
  connection: SqliteConnection
): DocumentEmbeddingsRepositoryPort {
  if (backend === 'sqlite') {
    return new DocumentEmbeddingsRepository(connection)
  }

  return new QdrantDocumentEmbeddingsRepository(
    new SqliteDocumentEmbeddingMetadataStore(connection),
    {
      endpoint: 'http://127.0.0.1:6333',
      collectionPrefix: 'lucentdocs',
      fetchImpl: createQdrantFetchMock(),
    }
  )
}

for (const backend of ['sqlite', 'qdrant'] as const) {
  describe(`document embeddings repository (${backend})`, () => {
    test('replace, stale guard, and find work consistently', async () => {
      const connection = createConnection(':memory:')
      const repo = createRepository(backend, connection)

      insertDocument(connection, 'doc_a', 'a.md')

      const first = await repo.replaceEmbeddings({
        documentId: 'doc_a',
        providerConfigId: null,
        providerId: 'provider',
        type: 'openai',
        baseURL: 'https://openrouter.ai/api/v1',
        model: 'test-model',
        strategy: { type: 'whole_document', properties: {} },
        documentTimestamp: 100,
        contentHash: 'hash-v1',
        chunks: [
          {
            ordinal: 0,
            start: 0,
            end: 5,
            text: 'hello',
            embedding: [1, 0, 0],
          },
        ],
        createdAt: 100,
        updatedAt: 100,
      })

      expect(first.status).toBe('applied')
      expect(first.embeddings).toHaveLength(1)

      const stale = await repo.replaceEmbeddings({
        documentId: 'doc_a',
        providerConfigId: null,
        providerId: 'provider',
        type: 'openai',
        baseURL: 'https://openrouter.ai/api/v1',
        model: 'test-model',
        strategy: { type: 'whole_document', properties: {} },
        documentTimestamp: 99,
        contentHash: 'hash-v2',
        chunks: [
          {
            ordinal: 0,
            start: 0,
            end: 7,
            text: 'changed',
            embedding: [0, 1, 0],
          },
        ],
        createdAt: 101,
        updatedAt: 101,
      })

      expect(stale.status).toBe('stale')
      expect(stale.embeddings[0]?.contentHash).toBe('hash-v1')

      const stored = await repo.findEmbeddings(
        'doc_a',
        'https://openrouter.ai/api/v1',
        'test-model'
      )
      expect(stored).toHaveLength(1)
      expect(stored[0]?.contentHash).toBe('hash-v1')

      connection.close()
    })

    test('searchDocument returns top matching chunk', async () => {
      const connection = createConnection(':memory:')
      const repo = createRepository(backend, connection)

      insertDocument(connection, 'doc_a', 'a.md')

      await repo.replaceEmbeddings({
        documentId: 'doc_a',
        providerConfigId: null,
        providerId: 'provider',
        type: 'openai',
        baseURL: 'https://openrouter.ai/api/v1',
        model: 'test-model',
        strategy: { type: 'whole_document', properties: {} },
        documentTimestamp: 100,
        contentHash: 'hash-v1',
        chunks: [
          {
            ordinal: 0,
            start: 0,
            end: 5,
            text: 'alpha',
            embedding: [1, 0, 0],
          },
          {
            ordinal: 1,
            start: 6,
            end: 10,
            text: 'beta',
            embedding: [0, 1, 0],
          },
        ],
        createdAt: 100,
        updatedAt: 100,
      })

      const matches = await repo.searchDocument({
        documentId: 'doc_a',
        baseURL: 'https://openrouter.ai/api/v1',
        model: 'test-model',
        queryEmbedding: [0.95, 0.05, 0],
        limit: 1,
      })

      expect(matches).toHaveLength(1)
      expect(matches[0]?.chunkOrdinal).toBe(0)
      expect(matches[0]?.chunkText).toBe('alpha')

      connection.close()
    })

    test('searchProjectDocuments honors scoped project filters', async () => {
      const connection = createConnection(':memory:')
      const repo = createRepository(backend, connection)

      insertProject(connection, 'proj_1')
      insertDocument(connection, 'doc_root', 'root.md')
      insertDocument(connection, 'doc_nested', 'docs/a.md')
      linkDocumentToProject(connection, 'proj_1', 'doc_root')
      linkDocumentToProject(connection, 'proj_1', 'doc_nested')

      await repo.replaceEmbeddings({
        documentId: 'doc_root',
        providerConfigId: null,
        providerId: 'provider',
        type: 'openai',
        baseURL: 'https://openrouter.ai/api/v1',
        model: 'test-model',
        strategy: { type: 'whole_document', properties: {} },
        documentTimestamp: 100,
        contentHash: 'hash-root',
        chunks: [
          {
            ordinal: 0,
            start: 0,
            end: 4,
            text: 'root',
            embedding: [1, 0, 0],
          },
        ],
        createdAt: 100,
        updatedAt: 100,
      })

      await repo.replaceEmbeddings({
        documentId: 'doc_nested',
        providerConfigId: null,
        providerId: 'provider',
        type: 'openai',
        baseURL: 'https://openrouter.ai/api/v1',
        model: 'test-model',
        strategy: { type: 'whole_document', properties: {} },
        documentTimestamp: 100,
        contentHash: 'hash-nested',
        chunks: [
          {
            ordinal: 0,
            start: 0,
            end: 6,
            text: 'nested',
            embedding: [0, 1, 0],
          },
        ],
        createdAt: 100,
        updatedAt: 100,
      })

      const matches = await repo.searchProjectDocuments({
        projectId: 'proj_1',
        baseURL: 'https://openrouter.ai/api/v1',
        model: 'test-model',
        queryEmbedding: [0.01, 0.99, 0],
        limit: 5,
        scope: { type: 'directory_subtree', directoryPath: 'docs' },
      })

      expect(matches.length).toBeGreaterThan(0)
      expect(matches.every((match) => match.documentId === 'doc_nested')).toBe(true)

      connection.close()
    })

    test('deleteEmbeddingsByDocumentId removes searchable vectors and metadata', async () => {
      const connection = createConnection(':memory:')
      const repo = createRepository(backend, connection)

      insertDocument(connection, 'doc_a', 'a.md')

      await repo.replaceEmbeddings({
        documentId: 'doc_a',
        providerConfigId: null,
        providerId: 'provider',
        type: 'openai',
        baseURL: 'https://openrouter.ai/api/v1',
        model: 'test-model',
        strategy: { type: 'whole_document', properties: {} },
        documentTimestamp: 100,
        contentHash: 'hash-v1',
        chunks: [
          {
            ordinal: 0,
            start: 0,
            end: 5,
            text: 'alpha',
            embedding: [1, 0, 0],
          },
        ],
        createdAt: 100,
        updatedAt: 100,
      })

      await repo.deleteEmbeddingsByDocumentId('doc_a')

      const stored = await repo.findEmbeddings(
        'doc_a',
        'https://openrouter.ai/api/v1',
        'test-model'
      )
      expect(stored).toHaveLength(0)

      const matches = await repo.searchDocument({
        documentId: 'doc_a',
        baseURL: 'https://openrouter.ai/api/v1',
        model: 'test-model',
        queryEmbedding: [1, 0, 0],
        limit: 5,
      })
      expect(matches).toHaveLength(0)

      connection.close()
    })

    if (backend === 'sqlite') {
      test('deleteVectorsByReferences can clean vec tables after metadata cascades', async () => {
        const connection = createConnection(':memory:')
        const repo = createRepository(backend, connection)

        insertDocument(connection, 'doc_a', 'a.md')

        await repo.replaceEmbeddings({
          documentId: 'doc_a',
          providerConfigId: null,
          providerId: 'provider',
          type: 'openai',
          baseURL: 'https://openrouter.ai/api/v1',
          model: 'test-model',
          strategy: { type: 'whole_document', properties: {} },
          documentTimestamp: 100,
          contentHash: 'hash-v1',
          chunks: [
            {
              ordinal: 0,
              start: 0,
              end: 5,
              text: 'alpha',
              embedding: [1, 0, 0],
            },
          ],
          createdAt: 100,
          updatedAt: 100,
        })

        const references = await repo.listVectorReferencesByDocumentIds(['doc_a'])
        expect(references.length).toBeGreaterThan(0)

        const beforeVecCount = connection.get<{ count: number }>(
          'SELECT COUNT(*) AS count FROM document_embedding_vec_3',
          []
        )
        expect(beforeVecCount?.count ?? 0).toBe(1)

        // Simulate a document delete: cascades metadata + vector-row mapping, leaving vec0 rows behind.
        connection.run('DELETE FROM documents WHERE id = ?', ['doc_a'])

        const afterMetadata = connection.get<{ count: number }>(
          'SELECT COUNT(*) AS count FROM document_embeddings WHERE documentId = ?',
          ['doc_a']
        )
        expect(afterMetadata?.count ?? 0).toBe(0)

        await repo.deleteVectorsByReferences(references)

        const vecTable = connection.get<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
          ['document_embedding_vec_3']
        )
        expect(vecTable).toBeNull()

        connection.close()
      })
    }
  })
}
