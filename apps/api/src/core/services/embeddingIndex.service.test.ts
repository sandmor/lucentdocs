import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSqliteAdapter } from '../../infrastructure/sqlite/factory.js'
import { configureEmbeddingProvider, resetEmbeddingClient } from '../../embeddings/provider.js'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

function uniqueDbPath(label: string): string {
  const dir = resolve(`data-test/${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return resolve(dir, 'app.db')
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

describe('EmbeddingIndexService', () => {
  const originalFetch = globalThis.fetch
  let cleanupDir: string | null = null

  const readFetchUrl = (input: string | URL | Request): string => {
    if (typeof input === 'string') return input
    return input instanceof URL ? input.toString() : input.url
  }

  beforeEach(() => {
    globalThis.fetch = (async (input) => {
      const url = readFetchUrl(input)
      if (url === `${OPENROUTER_BASE_URL}/embeddings`) {
        return jsonResponse({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        })
      }
      throw new Error(`Unexpected fetch ${url}`)
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    resetEmbeddingClient()
    if (cleanupDir) {
      rmSync(cleanupDir, { recursive: true, force: true })
      cleanupDir = null
    }
  })

  test('flushes queued documents into sqlite-vec storage', async () => {
    const dbPath = uniqueDbPath('embedding-index-service-store')
    cleanupDir = resolve(dbPath, '..')
    const adapter = createSqliteAdapter(dbPath)

    await adapter.services.aiSettings.initializeDefaults({
      env: {
        AI_BASE_URL: OPENROUTER_BASE_URL,
        AI_MODEL: 'gpt-5',
        AI_API_KEY: 'test-key',
      },
    })
    configureEmbeddingProvider(adapter.services.aiSettings)

    const doc = await adapter.services.documents.create(
      'notes.md',
      JSON.stringify({
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello embeddings' }] }],
        },
        aiDraft: null,
      })
    )

    await adapter.repositories.documentEmbeddings.clearQueuedDocuments([doc.id])
    await adapter.services.embeddingIndex.enqueueDocument(doc.id, { queuedAt: 1000, debounceMs: 0 })

    const result = await adapter.services.embeddingIndex.flushDueQueue(
      { debounceMs: 0, batchMaxWaitMs: 5000 },
      1000
    )

    expect(result.processed).toBe(1)
    const stored = await adapter.repositories.documentEmbeddings.findEmbeddings(
      doc.id,
      OPENROUTER_BASE_URL,
      'openai/text-embedding-3-small'
    )
    expect(stored).toHaveLength(1)
    expect(stored[0]?.dimensions).toBe(3)
    expect(stored[0]?.strategy.type).toBe('sliding_window')
    expect(stored[0]?.documentTimestamp).toBe(1000)

    adapter.connection.close()
  })

  test('flushes a waiting batch once the oldest queued document exceeds max wait', async () => {
    const dbPath = uniqueDbPath('embedding-index-service-max-wait')
    cleanupDir = resolve(dbPath, '..')
    const adapter = createSqliteAdapter(dbPath)

    await adapter.services.aiSettings.initializeDefaults({
      env: {
        AI_BASE_URL: OPENROUTER_BASE_URL,
        AI_MODEL: 'gpt-5',
        AI_API_KEY: 'test-key',
      },
    })
    configureEmbeddingProvider(adapter.services.aiSettings)

    const doc = await adapter.services.documents.create(
      'batch.md',
      JSON.stringify({
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'batch me' }] }],
        },
        aiDraft: null,
      })
    )

    await adapter.repositories.documentEmbeddings.clearQueuedDocuments([doc.id])
    await adapter.services.embeddingIndex.enqueueDocument(doc.id, {
      queuedAt: 1000,
      debounceMs: 10_000,
    })

    const early = await adapter.services.embeddingIndex.flushDueQueue(
      { debounceMs: 10_000, batchMaxWaitMs: 2_000 },
      1500
    )
    expect(early.processed).toBe(0)

    const late = await adapter.services.embeddingIndex.flushDueQueue(
      { debounceMs: 10_000, batchMaxWaitMs: 2_000 },
      3100
    )
    expect(late.processed).toBe(1)

    adapter.connection.close()
  })

  test('does not overwrite with stale embeddings after a document is re-queued mid-flush', async () => {
    let resolveFetch!: (value: Response) => void
    let hasPendingFetch = false
    let fetchStarted: (() => void) | null = null
    const fetchStartedPromise = new Promise<void>((resolve) => {
      fetchStarted = resolve
    })

    globalThis.fetch = ((input) => {
      const url = readFetchUrl(input)
      if (url !== `${OPENROUTER_BASE_URL}/embeddings`) {
        throw new Error(`Unexpected fetch ${url}`)
      }
      fetchStarted?.()
      return new Promise<Response>((resolve) => {
        hasPendingFetch = true
        resolveFetch = resolve
      })
    }) as typeof fetch

    const dbPath = uniqueDbPath('embedding-index-service-stale-flush')
    cleanupDir = resolve(dbPath, '..')
    const adapter = createSqliteAdapter(dbPath)

    await adapter.services.aiSettings.initializeDefaults({
      env: {
        AI_BASE_URL: OPENROUTER_BASE_URL,
        AI_MODEL: 'gpt-5',
        AI_API_KEY: 'test-key',
      },
    })
    configureEmbeddingProvider(adapter.services.aiSettings)

    const doc = await adapter.services.documents.create(
      'stale.md',
      JSON.stringify({
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'stale test' }] }],
        },
        aiDraft: null,
      })
    )

    await adapter.repositories.documentEmbeddings.clearQueuedDocuments([doc.id])
    await adapter.services.embeddingIndex.enqueueDocument(doc.id, { queuedAt: 1000, debounceMs: 0 })

    const firstFlushPromise = adapter.services.embeddingIndex.flushDueQueue(
      { debounceMs: 0, batchMaxWaitMs: 5_000 },
      1000
    )

    await fetchStartedPromise
    await adapter.services.embeddingIndex.enqueueDocument(doc.id, { queuedAt: 1000, debounceMs: 0 })

    if (!hasPendingFetch) {
      throw new Error('Expected the first embedding request to be pending.')
    }

    resolveFetch(
      jsonResponse({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      })
    )

    const firstFlush = await firstFlushPromise
    expect(firstFlush.processed).toBe(0)

    const storedAfterFirst = await adapter.repositories.documentEmbeddings.findEmbeddings(
      doc.id,
      OPENROUTER_BASE_URL,
      'openai/text-embedding-3-small'
    )
    expect(storedAfterFirst).toHaveLength(0)

    const statsAfterFirst = await adapter.repositories.documentEmbeddings.getQueueStats()
    expect(statsAfterFirst.totalJobs).toBe(1)

    globalThis.fetch = (async (input) => {
      const url = readFetchUrl(input)
      if (url === `${OPENROUTER_BASE_URL}/embeddings`) {
        return jsonResponse({
          data: [{ embedding: [0.4, 0.5, 0.6] }],
        })
      }
      throw new Error(`Unexpected fetch ${url}`)
    }) as typeof fetch

    const secondFlush = await adapter.services.embeddingIndex.flushDueQueue(
      { debounceMs: 0, batchMaxWaitMs: 5_000 },
      1001
    )
    expect(secondFlush.processed).toBe(1)

    const storedAfterSecond = await adapter.repositories.documentEmbeddings.findEmbeddings(
      doc.id,
      OPENROUTER_BASE_URL,
      'openai/text-embedding-3-small'
    )
    expect(storedAfterSecond).toHaveLength(1)

    const statsAfterSecond = await adapter.repositories.documentEmbeddings.getQueueStats()
    expect(statsAfterSecond.totalJobs).toBe(0)

    adapter.connection.close()
  })

  test('stores multiple embedding chunks when a document uses sliding window indexing', async () => {
    globalThis.fetch = (async (input) => {
      const url = readFetchUrl(input)
      if (url === `${OPENROUTER_BASE_URL}/embeddings`) {
        return jsonResponse({
          data: [
            { embedding: [0.1, 0.2, 0.3] },
            { embedding: [0.4, 0.5, 0.6] },
            { embedding: [0.7, 0.8, 0.9] },
            { embedding: [1.0, 1.1, 1.2] },
          ],
        })
      }
      throw new Error(`Unexpected fetch ${url}`)
    }) as typeof fetch

    const dbPath = uniqueDbPath('embedding-index-service-sliding-window')
    cleanupDir = resolve(dbPath, '..')
    const adapter = createSqliteAdapter(dbPath)

    await adapter.services.aiSettings.initializeDefaults({
      env: {
        AI_BASE_URL: OPENROUTER_BASE_URL,
        AI_MODEL: 'gpt-5',
        AI_API_KEY: 'test-key',
      },
    })
    configureEmbeddingProvider(adapter.services.aiSettings)

    const doc = await adapter.services.documents.create(
      'windowed.md',
      JSON.stringify({
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'abcdefghijklmnopqrstuvwxyz' }],
            },
          ],
        },
        aiDraft: null,
      })
    )

    await adapter.services.indexingSettings.updateDocumentStrategy(doc.id, {
      type: 'sliding_window',
      properties: {
        level: 'character',
        windowSize: 16,
        stride: 10,
      },
    })

    await adapter.repositories.documentEmbeddings.clearQueuedDocuments([doc.id])
    await adapter.services.embeddingIndex.enqueueDocument(doc.id, { queuedAt: 1000, debounceMs: 0 })

    const result = await adapter.services.embeddingIndex.flushDueQueue(
      { debounceMs: 0, batchMaxWaitMs: 5000 },
      1000
    )

    expect(result.processed).toBe(1)

    const stored = await adapter.repositories.documentEmbeddings.findEmbeddings(
      doc.id,
      OPENROUTER_BASE_URL,
      'openai/text-embedding-3-small'
    )

    expect(stored.length).toBeGreaterThan(1)
    expect(stored.map((entry) => entry.chunkOrdinal)).toEqual([0, 1, 2, 3])
    expect(stored.every((entry) => entry.strategy.type === 'sliding_window')).toBe(true)

    adapter.connection.close()
  })

  test('handles empty documents by deleting existing embeddings and clearing queue', async () => {
    const dbPath = uniqueDbPath('embedding-index-service-empty-doc')
    cleanupDir = resolve(dbPath, '..')
    const adapter = createSqliteAdapter(dbPath)

    await adapter.services.aiSettings.initializeDefaults({
      env: {
        AI_BASE_URL: OPENROUTER_BASE_URL,
        AI_MODEL: 'gpt-5',
        AI_API_KEY: 'test-key',
      },
    })
    configureEmbeddingProvider(adapter.services.aiSettings)

    const doc = await adapter.services.documents.create(
      '',
      JSON.stringify({
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph' }],
        },
        aiDraft: null,
      })
    )

    await adapter.repositories.documentEmbeddings.clearQueuedDocuments([doc.id])

    await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: doc.id,
      providerConfigId: null,
      providerId: 'test-provider',
      type: 'openai',
      baseURL: OPENROUTER_BASE_URL,
      model: 'openai/text-embedding-3-small',
      strategy: { type: 'whole_document', properties: {} },
      documentTimestamp: 999,
      contentHash: 'old-hash',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 10,
          text: 'old content',
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const existingBefore = await adapter.repositories.documentEmbeddings.findEmbeddings(
      doc.id,
      OPENROUTER_BASE_URL,
      'openai/text-embedding-3-small'
    )
    expect(existingBefore).toHaveLength(1)

    await adapter.services.embeddingIndex.enqueueDocument(doc.id, { queuedAt: 1000, debounceMs: 0 })

    const result = await adapter.services.embeddingIndex.flushDueQueue(
      { debounceMs: 0, batchMaxWaitMs: 5000 },
      1000
    )

    expect(result.processed).toBe(0)
    expect(result.skipped).toBe(0)

    const existingAfter = await adapter.repositories.documentEmbeddings.findEmbeddings(
      doc.id,
      OPENROUTER_BASE_URL,
      'openai/text-embedding-3-small'
    )
    expect(existingAfter).toHaveLength(0)

    const queueStats = await adapter.repositories.documentEmbeddings.getQueueStats()
    expect(queueStats.totalJobs).toBe(0)

    adapter.connection.close()
  })

  test('ignores stale repository replacements when a newer document timestamp already exists', async () => {
    const dbPath = uniqueDbPath('embedding-index-service-stale-repository-write')
    cleanupDir = resolve(dbPath, '..')
    const adapter = createSqliteAdapter(dbPath)

    const doc = await adapter.services.documents.create('race.md')

    const newer = await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: doc.id,
      providerConfigId: null,
      providerId: 'test-provider',
      type: 'openai',
      baseURL: OPENROUTER_BASE_URL,
      model: 'test-model',
      strategy: { type: 'whole_document', properties: {} },
      documentTimestamp: 200,
      contentHash: 'newer-hash',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 5,
          text: 'newer',
          embedding: [0.4, 0.5, 0.6],
        },
      ],
      createdAt: 200,
      updatedAt: 200,
    })
    expect(newer.status).toBe('applied')

    const stale = await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: doc.id,
      providerConfigId: null,
      providerId: 'test-provider',
      type: 'openai',
      baseURL: OPENROUTER_BASE_URL,
      model: 'test-model',
      strategy: { type: 'whole_document', properties: {} },
      documentTimestamp: 100,
      contentHash: 'stale-hash',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 5,
          text: 'stale',
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      createdAt: 100,
      updatedAt: 100,
    })

    expect(stale.status).toBe('stale')
    expect(stale.embeddings).toHaveLength(1)
    expect(stale.embeddings[0]?.contentHash).toBe('newer-hash')
    expect(stale.embeddings[0]?.documentTimestamp).toBe(200)

    adapter.connection.close()
  })

  test('keeps embeddings for the same model isolated by base URL', async () => {
    const dbPath = uniqueDbPath('embedding-index-service-baseurl-scope')
    cleanupDir = resolve(dbPath, '..')
    const adapter = createSqliteAdapter(dbPath)

    const doc = await adapter.services.documents.create('scope.md')

    const firstWrite = await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: doc.id,
      providerConfigId: null,
      providerId: 'test-provider',
      type: 'openai',
      baseURL: 'https://provider-a.example/v1',
      model: 'shared-model',
      strategy: { type: 'whole_document', properties: {} },
      documentTimestamp: 100,
      contentHash: 'provider-a',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 5,
          text: 'alpha',
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      createdAt: 100,
      updatedAt: 100,
    })
    expect(firstWrite.status).toBe('applied')

    const secondWrite = await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: doc.id,
      providerConfigId: null,
      providerId: 'test-provider',
      type: 'openai',
      baseURL: 'https://provider-b.example/v1',
      model: 'shared-model',
      strategy: { type: 'whole_document', properties: {} },
      documentTimestamp: 90,
      contentHash: 'provider-b',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 4,
          text: 'beta',
          embedding: [0.4, 0.5, 0.6],
        },
      ],
      createdAt: 90,
      updatedAt: 90,
    })
    expect(secondWrite.status).toBe('applied')

    const providerAEmbeddings = await adapter.repositories.documentEmbeddings.findEmbeddings(
      doc.id,
      'https://provider-a.example/v1',
      'shared-model'
    )
    const providerBEmbeddings = await adapter.repositories.documentEmbeddings.findEmbeddings(
      doc.id,
      'https://provider-b.example/v1',
      'shared-model'
    )

    expect(providerAEmbeddings).toHaveLength(1)
    expect(providerAEmbeddings[0]?.contentHash).toBe('provider-a')
    expect(providerBEmbeddings).toHaveLength(1)
    expect(providerBEmbeddings[0]?.contentHash).toBe('provider-b')

    adapter.connection.close()
  })
})
