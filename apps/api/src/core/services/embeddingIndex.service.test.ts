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
    const stored = await adapter.repositories.documentEmbeddings.findEmbedding(
      doc.id,
      OPENROUTER_BASE_URL,
      'openai/text-embedding-3-small'
    )
    expect(stored).toBeDefined()
    expect(stored?.dimensions).toBe(3)

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

    const storedAfterFirst = await adapter.repositories.documentEmbeddings.findEmbedding(
      doc.id,
      OPENROUTER_BASE_URL,
      'openai/text-embedding-3-small'
    )
    expect(storedAfterFirst).toBeUndefined()

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

    const storedAfterSecond = await adapter.repositories.documentEmbeddings.findEmbedding(
      doc.id,
      OPENROUTER_BASE_URL,
      'openai/text-embedding-3-small'
    )
    expect(storedAfterSecond).toBeDefined()

    const statsAfterSecond = await adapter.repositories.documentEmbeddings.getQueueStats()
    expect(statsAfterSecond.totalJobs).toBe(0)

    adapter.connection.close()
  })
})
