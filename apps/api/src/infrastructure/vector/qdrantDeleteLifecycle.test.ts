import { describe, expect, test } from 'bun:test'
import { createSqliteAdapter } from '../sqlite/factory.js'
import { QdrantDocumentEmbeddingsRepository } from './qdrantDocumentEmbeddings.adapter.js'
import { createJobWorkerRuntime } from '../../app/job-worker-runtime.js'
import {
  createEmbeddingVectorCleanupBatchHandler,
  EMBEDDING_VECTOR_CLEANUP_JOB_TYPE,
} from '../../app/embedding-vector-cleanup-runtime.js'

function asUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

async function waitForCleanupJobs(
  adapter: ReturnType<typeof createSqliteAdapter>,
  timeoutMs = 2000
): Promise<number> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const queued = await adapter.jobQueue.listQueuedByType(EMBEDDING_VECTOR_CLEANUP_JOB_TYPE)
    if (queued.length > 0) return queued.length
    await Bun.sleep(10)
  }

  return 0
}

describe('Qdrant delete lifecycle', () => {
  test('deleteDirectoryForProject defers Qdrant point deletes to cleanup worker jobs', async () => {
    const calls: Array<{ url: string; method: string }> = []
    const collections = new Set<string>()

    const fetchImpl: typeof fetch = (async (input, init) => {
      const url = asUrl(input)
      const method = init?.method ?? 'GET'
      calls.push({ url, method })

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
        collections.add(collection)
        return new Response(JSON.stringify({ result: true }), { status: 200 })
      }

      if (url.includes(`/collections/${collection}/points?wait=true`) && method === 'PUT') {
        return new Response(JSON.stringify({ result: { status: 'acknowledged' } }), { status: 200 })
      }

      if (url.includes(`/collections/${collection}/points/delete?wait=true`) && method === 'POST') {
        return new Response(JSON.stringify({ result: { status: 'acknowledged' } }), { status: 200 })
      }

      throw new Error(`Unexpected qdrant request ${method} ${url}`)
    }) as typeof fetch

    const adapter = createSqliteAdapter(':memory:', {
      createDocumentEmbeddings: ({ metadataStore }) =>
        new QdrantDocumentEmbeddingsRepository(metadataStore, {
          endpoint: 'http://127.0.0.1:6333',
          collectionPrefix: 'lucentdocs',
          fetchImpl,
        }),
    })

    const project = await adapter.services.projects.create('Project', { ownerUserId: 'user_1' })
    const doc = await adapter.services.documents.createForProject(project.id, 'notes/scene-1.md')
    if (!doc) {
      throw new Error('Expected test document to be created.')
    }

    const now = Date.now()
    await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: doc.id,
      providerConfigId: null,
      providerId: 'provider',
      type: 'openai',
      baseURL: 'https://openrouter.ai/api/v1',
      model: 'test-model',
      strategy: { type: 'whole_document', properties: {} },
      documentTimestamp: now,
      contentHash: 'hash-v1',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 20,
          text: 'The moon rises.',
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

    const deleted = await adapter.services.documents.deleteDirectoryForProject(project.id, 'notes')
    expect(deleted).not.toBeNull()

    const remaining = await adapter.repositories.documentEmbeddings.findEmbeddings(
      doc.id,
      'https://openrouter.ai/api/v1',
      'test-model'
    )
    expect(remaining).toHaveLength(0)

    const deleteCallsBeforeWorker = calls.filter(
      (call) => call.method === 'POST' && call.url.includes('/points/delete?wait=true')
    )
    expect(deleteCallsBeforeWorker).toHaveLength(0)

    // Cleanup dispatch is deferred; wait until jobs are observable before worker tick.
    const queuedCleanupJobs = await waitForCleanupJobs(adapter)
    expect(queuedCleanupJobs).toBeGreaterThan(0)

    const worker = createJobWorkerRuntime({
      queue: adapter.jobQueue,
      handlers: {
        [EMBEDDING_VECTOR_CLEANUP_JOB_TYPE]: createEmbeddingVectorCleanupBatchHandler(
          adapter.repositories.documentEmbeddings
        ),
      },
    })
    worker.start()
    await worker.tickOnce()
    await worker.stop()

    const deleteCallsAfterWorker = calls.filter(
      (call) => call.method === 'POST' && call.url.includes('/points/delete?wait=true')
    )
    expect(deleteCallsAfterWorker.length).toBeGreaterThan(0)

    adapter.connection.close()
  })
})
