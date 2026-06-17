import { describe, expect, test } from 'bun:test'
import { createTestAdapter } from '../testing/factory.js'
import { scheduleVectorHealOnBackendChange } from './vector-heal-startup.js'

describe('scheduleVectorHealOnBackendChange', () => {
  test('schedules reindex once for first qdrant fingerprint and skips unchanged restart', async () => {
    const adapter = createTestAdapter()

    const project = await adapter.services.projects.create('Project', { ownerUserId: 'user_1' })
    const docA = await adapter.services.documents.createForProject(project.id, 'a.md')
    const docB = await adapter.services.documents.createForProject(project.id, 'b.md')
    if (!docA || !docB) {
      throw new Error('Expected test documents to be created.')
    }

    const enqueueCalls: Array<{ ids: string[]; debounceMs?: number }> = []
    adapter.services.embeddingIndex.enqueueDocuments = async (documentIds, options = {}) => {
      enqueueCalls.push({ ids: [...documentIds], debounceMs: options.debounceMs })
    }

    const first = await scheduleVectorHealOnBackendChange({
      engine: adapter.adapter.engine,
      vectorStorage: { kind: 'qdrant' },
      qdrantConfig: {
        endpoint: 'http://127.0.0.1:6333',
        collectionPrefix: 'lucentdocs',
      },
      documents: adapter.services.documents,
      embeddingIndex: adapter.services.embeddingIndex,
    })

    expect(first.scheduled).toBe(true)
    expect(first.reason).toBe('switched')
    expect(first.enqueuedDocumentCount).toBe(2)
    expect(enqueueCalls).toHaveLength(1)
    expect(enqueueCalls[0]?.ids.sort()).toEqual([docA.id, docB.id].sort())
    expect(enqueueCalls[0]?.debounceMs).toBe(0)

    const storedEntries = await adapter.adapter.engine.appConfigReadAll(null)
    const stored = storedEntries.find((entry) => entry.key === 'vector_storage_fingerprint')
    expect(stored?.value).toBe('qdrant:http://127.0.0.1:6333:lucentdocs')

    const second = await scheduleVectorHealOnBackendChange({
      engine: adapter.adapter.engine,
      vectorStorage: { kind: 'qdrant' },
      qdrantConfig: {
        endpoint: 'http://127.0.0.1:6333',
        collectionPrefix: 'lucentdocs',
      },
      documents: adapter.services.documents,
      embeddingIndex: adapter.services.embeddingIndex,
    })

    expect(second.scheduled).toBe(false)
    expect(second.reason).toBe('unchanged')
    expect(second.enqueuedDocumentCount).toBe(0)
    expect(enqueueCalls).toHaveLength(1)

    void adapter.adapter.engine.close()
  })

  test('switching backend fingerprint re-schedules qdrant reindex campaign', async () => {
    const adapter = createTestAdapter()

    const project = await adapter.services.projects.create('Project', { ownerUserId: 'user_1' })
    const doc = await adapter.services.documents.createForProject(project.id, 'a.md')
    if (!doc) {
      throw new Error('Expected test document to be created.')
    }

    let enqueueCallCount = 0
    adapter.services.embeddingIndex.enqueueDocuments = async () => {
      enqueueCallCount += 1
    }

    await scheduleVectorHealOnBackendChange({
      engine: adapter.adapter.engine,
      vectorStorage: { kind: 'qdrant' },
      qdrantConfig: {
        endpoint: 'http://127.0.0.1:6333',
        collectionPrefix: 'lucentdocs',
      },
      documents: adapter.services.documents,
      embeddingIndex: adapter.services.embeddingIndex,
    })

    await scheduleVectorHealOnBackendChange({
      engine: adapter.adapter.engine,
      vectorStorage: { kind: 'none' },
      documents: adapter.services.documents,
      embeddingIndex: adapter.services.embeddingIndex,
    })

    await scheduleVectorHealOnBackendChange({
      engine: adapter.adapter.engine,
      vectorStorage: { kind: 'qdrant' },
      qdrantConfig: {
        endpoint: 'http://127.0.0.1:6333',
        collectionPrefix: 'lucentdocs',
      },
      documents: adapter.services.documents,
      embeddingIndex: adapter.services.embeddingIndex,
    })

    expect(enqueueCallCount).toBe(2)

    void adapter.adapter.engine.close()
  })
})
