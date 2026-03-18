import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import { LOCAL_DEFAULT_USER, type User } from '../../core/models/user.js'
import type { AppContext } from '../index.js'
import { documentsRouter } from './documents.js'
import { createTestAdapter, type TestAdapter } from '../../testing/factory.js'
import { configureEmbeddingProvider, resetEmbeddingClient } from '../../embeddings/provider.js'
import { projectSyncBus } from '../project-sync.js'
import { projectSyncEventSchema } from './sync.js'
import {
  createDocumentImportJobHandler,
  createDocumentImportRuntime,
} from '../../app/document-import-runtime.js'
import { createJobWorkerRuntime } from '../../app/job-worker-runtime.js'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const activeWorkers: Array<ReturnType<typeof createJobWorkerRuntime>> = []

function createCallerContext(options?: { user?: User; adapter?: TestAdapter }): AppContext {
  const adapter = options?.adapter ?? createFileBackedAdapter()
  const currentUser = options?.user ?? LOCAL_DEFAULT_USER
  const documentImportRuntime = createDocumentImportRuntime({
    queue: adapter.jobQueue,
  })
  const worker = createJobWorkerRuntime({
    queue: adapter.jobQueue,
    handlers: {
      'documents.import': createDocumentImportJobHandler({
        dbPath: adapter.dbPath,
        services: adapter.services,
        repositories: adapter.repositories,
        transaction: adapter.transaction,
        hooks: {
          afterExternalWriteCommit: adapter.afterExternalWriteCommit,
        },
      }),
    },
  })
  worker.start()
  activeWorkers.push(worker)

  return {
    user: currentUser,
    services: adapter.services,
    authPort: {
      isEnabled: () => false,
      getUserById: async (userId: string) => (userId === currentUser.id ? currentUser : null),
      getUserByEmail: async (email: string) =>
        currentUser.email?.toLowerCase() === email.toLowerCase() ? currentUser : null,
      validateSession: async () => currentUser,
      login: async () => ({ success: false, error: 'not implemented' }),
      logout: async () => ({ success: true }),
      signup: async () => ({ success: false, error: 'not implemented' }),
    },
    yjsRuntime: {
      evictLiveDocument: () => {},
    } as unknown as AppContext['yjsRuntime'],
    chatRuntime: {} as AppContext['chatRuntime'],
    inlineRuntime: {} as AppContext['inlineRuntime'],
    documentImportRuntime,
  }
}

function createFileBackedAdapter(): TestAdapter {
  const dir = mkdtempSync(join(tmpdir(), 'lucentdocs-doc-import-test-'))
  return createTestAdapter({ dbPath: join(dir, 'sqlite.db') })
}

async function waitFor<T>(fn: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
  const maxAttempts = 100
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const value = await fn()
    if (predicate(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  throw new Error('Timed out waiting for background import to complete')
}

async function initializeEmbeddingSelection(adapter: TestAdapter): Promise<void> {
  await adapter.services.aiSettings.initializeDefaults({
    env: {
      AI_PROVIDER: 'openrouter',
      AI_BASE_URL: OPENROUTER_BASE_URL,
      AI_MODEL: 'gpt-5',
      AI_API_KEY: 'test-key',
    },
  })
  configureEmbeddingProvider(adapter.services.aiSettings)
}

describe('documentsRouter', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
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
  })

  afterEach(async () => {
    while (activeWorkers.length > 0) {
      const worker = activeWorkers.pop()
      if (!worker) continue
      await worker.stop()
    }
    globalThis.fetch = originalFetch
    resetEmbeddingClient()
  })

  test('search returns project-linked matches for the active embedding model and groups snippets by document', async () => {
    const user: User = {
      id: 'owner_1',
      name: 'Owner One',
      email: 'owner1@example.com',
      role: 'user',
    }
    const adapter = createTestAdapter()
    await initializeEmbeddingSelection(adapter)

    const projectA = await adapter.services.projects.create('Story', { ownerUserId: user.id })
    const projectB = await adapter.services.projects.create('Shared', { ownerUserId: user.id })

    const sharedDoc = await adapter.services.documents.createForProject(projectA.id, 'shared.md')
    const localDoc = await adapter.services.documents.createForProject(projectA.id, 'local.md')
    const foreignDoc = await adapter.services.documents.createForProject(projectB.id, 'foreign.md')
    const mismatchedModelDoc = await adapter.services.documents.createForProject(
      projectA.id,
      'mismatch.md'
    )

    if (!sharedDoc || !localDoc || !foreignDoc || !mismatchedModelDoc) {
      throw new Error('Expected test documents to be created.')
    }

    await adapter.repositories.projectDocuments.insert({
      projectId: projectB.id,
      documentId: sharedDoc.id,
      addedAt: Date.now(),
    })

    const now = Date.now()
    await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: sharedDoc.id,
      providerConfigId: null,
      providerId: 'openrouter',
      type: 'openrouter',
      baseURL: OPENROUTER_BASE_URL,
      model: 'openai/text-embedding-3-small',
      strategy: {
        type: 'sliding_window',
        properties: {
          level: 'paragraph',
          windowSize: 2,
          stride: 1,
          minUnitChars: 40,
          maxUnitChars: 400,
        },
      },
      documentTimestamp: 100,
      contentHash: 'shared-hash',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 60,
          selectionFrom: 5,
          selectionTo: 39,
          text: 'Moonlight floods the silver forest and settles over the pines.',
          embedding: [0.1, 0.2, 0.3],
        },
        {
          ordinal: 1,
          start: 18,
          end: 72,
          selectionFrom: 42,
          selectionTo: 84,
          text: 'The silver forest glows again as moonlight brushes the pine needles.',
          embedding: [0.11, 0.2, 0.29],
        },
        {
          ordinal: 2,
          start: 110,
          end: 170,
          selectionFrom: 108,
          selectionTo: 152,
          text: 'Across the lake, moonlight catches on silver reeds and still water.',
          embedding: [0.12, 0.19, 0.28],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

    await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: localDoc.id,
      providerConfigId: null,
      providerId: 'openrouter',
      type: 'openrouter',
      baseURL: OPENROUTER_BASE_URL,
      model: 'openai/text-embedding-3-small',
      strategy: { type: 'whole_document', properties: {} },
      documentTimestamp: 101,
      contentHash: 'local-hash',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 58,
          text: 'The copper city wakes at dawn while market bells echo through the square.',
          embedding: [0.35, 0.35, 0.35],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

    await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: foreignDoc.id,
      providerConfigId: null,
      providerId: 'openrouter',
      type: 'openrouter',
      baseURL: OPENROUTER_BASE_URL,
      model: 'openai/text-embedding-3-small',
      strategy: { type: 'whole_document', properties: {} },
      documentTimestamp: 102,
      contentHash: 'foreign-hash',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 48,
          text: 'This remote archive should never appear in project A results.',
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

    await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: mismatchedModelDoc.id,
      providerConfigId: null,
      providerId: 'openrouter',
      type: 'openrouter',
      baseURL: OPENROUTER_BASE_URL,
      model: 'other-embedding-model',
      strategy: { type: 'whole_document', properties: {} },
      documentTimestamp: 103,
      contentHash: 'mismatch-hash',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 54,
          text: 'Wrong model rows should be ignored even when the text looks relevant.',
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

    const caller = documentsRouter.createCaller(
      createCallerContext({
        user,
        adapter,
      })
    )

    const results = await caller.search({
      projectId: projectA.id,
      query: 'silver moonlight forest',
      limit: 5,
      scope: { type: 'project' },
    })

    expect(results.map((result) => result.id)).toEqual([sharedDoc.id, localDoc.id])
    expect(results[0]?.matchType).toBe('snippet')
    expect(results[0]?.snippets).toHaveLength(3)
    expect(results[0]?.snippets[0]?.text.toLowerCase()).toContain('moonlight')
    expect(results[0]?.snippets[0]).toMatchObject({ selectionFrom: 5, selectionTo: 39 })
    expect(results[1]?.matchType).toBe('whole_document')
    expect(results[1]?.snippets).toEqual([])
    expect(results.some((result) => result.id === foreignDoc.id)).toBe(false)
    expect(results.some((result) => result.id === mismatchedModelDoc.id)).toBe(false)
  })

  test('search supports directory subtree scope for semantic results', async () => {
    const user: User = {
      id: 'owner_1',
      name: 'Owner One',
      email: 'owner1@example.com',
      role: 'user',
    }
    const adapter = createTestAdapter()
    await initializeEmbeddingSelection(adapter)

    const project = await adapter.services.projects.create('Story', { ownerUserId: user.id })
    const inScopeDoc = await adapter.services.documents.createForProject(
      project.id,
      'notes/chapter-one/scene-a.md'
    )
    const outOfScopeDoc = await adapter.services.documents.createForProject(
      project.id,
      'notes/chapter-two/scene-b.md'
    )

    if (!inScopeDoc || !outOfScopeDoc) {
      throw new Error('Expected scoped test documents to be created.')
    }

    const now = Date.now()
    await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: inScopeDoc.id,
      providerConfigId: null,
      providerId: 'openrouter',
      type: 'openrouter',
      baseURL: OPENROUTER_BASE_URL,
      model: 'openai/text-embedding-3-small',
      strategy: { type: 'whole_document', properties: {} },
      documentTimestamp: 200,
      contentHash: 'in-scope-hash',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 64,
          text: 'Moonlight gathers over the forest floor where the path splits in two.',
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

    await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: outOfScopeDoc.id,
      providerConfigId: null,
      providerId: 'openrouter',
      type: 'openrouter',
      baseURL: OPENROUTER_BASE_URL,
      model: 'openai/text-embedding-3-small',
      strategy: { type: 'whole_document', properties: {} },
      documentTimestamp: 201,
      contentHash: 'out-scope-hash',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 68,
          text: 'Moonlight crosses the distant market while the harbor bells ring.',
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

    const caller = documentsRouter.createCaller(
      createCallerContext({
        user,
        adapter,
      })
    )

    const results = await caller.search({
      projectId: project.id,
      query: 'moonlight path',
      scope: { type: 'directory_subtree', directoryPath: 'notes/chapter-one' },
      limit: 10,
    })

    expect(results.map((result) => result.id)).toEqual([inScopeDoc.id])
  })

  test('search supports root directory scope for semantic results', async () => {
    const user: User = {
      id: 'owner_1',
      name: 'Owner One',
      email: 'owner1@example.com',
      role: 'user',
    }
    const adapter = createTestAdapter()
    await initializeEmbeddingSelection(adapter)

    const project = await adapter.services.projects.create('Story', { ownerUserId: user.id })
    const rootDoc = await adapter.services.documents.createForProject(project.id, 'root-note.md')
    const nestedDoc = await adapter.services.documents.createForProject(
      project.id,
      'notes/chapter-one/scene-a.md'
    )

    if (!rootDoc || !nestedDoc) {
      throw new Error('Expected root-scope test documents to be created.')
    }

    const now = Date.now()
    await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: rootDoc.id,
      providerConfigId: null,
      providerId: 'openrouter',
      type: 'openrouter',
      baseURL: OPENROUTER_BASE_URL,
      model: 'openai/text-embedding-3-small',
      strategy: { type: 'whole_document', properties: {} },
      documentTimestamp: 300,
      contentHash: 'root-hash',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 48,
          text: 'Moonlight catches the root-level note by the door.',
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

    await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: nestedDoc.id,
      providerConfigId: null,
      providerId: 'openrouter',
      type: 'openrouter',
      baseURL: OPENROUTER_BASE_URL,
      model: 'openai/text-embedding-3-small',
      strategy: { type: 'whole_document', properties: {} },
      documentTimestamp: 301,
      contentHash: 'nested-hash',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 62,
          text: 'Moonlight reaches the nested scene deeper in the chapter notes.',
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

    const caller = documentsRouter.createCaller(
      createCallerContext({
        user,
        adapter,
      })
    )

    const results = await caller.search({
      projectId: project.id,
      query: 'moonlight note',
      scope: { type: 'directory', directoryPath: '' },
      limit: 10,
    })

    expect(results.map((result) => result.id)).toEqual([rootDoc.id])
  })

  test('get returns documents linked to the project even when they are shared across projects', async () => {
    const user: User = {
      id: 'owner_1',
      name: 'Owner One',
      email: 'owner1@example.com',
      role: 'user',
    }
    const adapter = createTestAdapter()

    const projectA = await adapter.services.projects.create('Story', { ownerUserId: user.id })
    const projectB = await adapter.services.projects.create('Shared', { ownerUserId: user.id })
    const document = await adapter.services.documents.createForProject(projectA.id, 'shared.md')

    if (!document) {
      throw new Error('Expected a shared document to be created.')
    }

    await adapter.repositories.projectDocuments.insert({
      projectId: projectB.id,
      documentId: document.id,
      addedAt: Date.now(),
    })

    const caller = documentsRouter.createCaller(
      createCallerContext({
        user,
        adapter,
      })
    )

    const result = await caller.get({
      projectId: projectB.id,
      id: document.id,
    })

    expect(result.id).toBe(document.id)
    expect(result.title).toBe('shared.md')
  })

  test('importLimits exposes document import limits to authenticated users', async () => {
    const adapter = createTestAdapter()
    const caller = documentsRouter.createCaller(createCallerContext({ adapter }))
    const limits = await caller.importLimits()

    expect(typeof limits.docImportChars).toBe('number')
    expect(typeof limits.docImportBatchDocs).toBe('number')
    expect(typeof limits.transferMaxBytes).toBe('number')
    expect(limits.transferMaxBytes).toBeGreaterThan(0)
  })

  test('importMany imports multiple docs and reports per-item failures', async () => {
    const adapter = createFileBackedAdapter()
    const user = LOCAL_DEFAULT_USER
    const project = await adapter.services.projects.create('Import', { ownerUserId: user.id })

    const caller = documentsRouter.createCaller(createCallerContext({ user, adapter }))
    const result = await caller.importMany({
      projectId: project.id,
      documents: [
        { title: 'good.md', markdown: '# Good\\n\\nHello' },
        { title: 'bad/__dir__/nope.md', markdown: '# Bad\\n\\nNope' },
      ],
      parseFailureMode: 'fail',
    })

    expect(result.status).toBe('queued')
    expect(result.queued).toBe(2)

    const listed = await waitFor(
      () => adapter.services.documents.listForProject(project.id),
      (docs) => docs.length === 1
    )
    const titles = listed.map((d) => d.title)
    expect(titles).toContain('good.md')

    const importedDoc = listed.find((doc) => doc.title === 'good.md')
    expect(importedDoc).toBeTruthy()
    if (!importedDoc) return

    const persistedYjs = await adapter.repositories.yjsDocuments.getPersisted(importedDoc.id)
    expect(persistedYjs).toBeTruthy()
    expect((persistedYjs?.length ?? 0) > 0).toBe(true)

    const ydoc = new Y.Doc()
    Y.applyUpdate(ydoc, new Uint8Array(persistedYjs as Buffer))
    const fragment = ydoc.getXmlFragment('prosemirror')
    expect(fragment.length).toBeGreaterThan(0)
    ydoc.destroy()
  })

  test('importMany resolves title collisions within the same batch', async () => {
    const adapter = createFileBackedAdapter()
    const user = LOCAL_DEFAULT_USER
    const project = await adapter.services.projects.create('Import', { ownerUserId: user.id })

    const caller = documentsRouter.createCaller(createCallerContext({ user, adapter }))
    const result = await caller.importMany({
      projectId: project.id,
      documents: [
        { title: 'same.md', markdown: '# One' },
        { title: 'same.md', markdown: '# Two' },
      ],
      parseFailureMode: 'fail',
    })

    expect(result.status).toBe('queued')
    const docs = await waitFor(
      () => adapter.services.documents.listForProject(project.id),
      (items) => items.length === 2
    )
    const importedTitles = docs.map((d) => d.title).sort()
    expect(importedTitles[0]).toBe('same-1.md')
    expect(importedTitles[1]).toBe('same.md')
  })

  test('importMany publishes sync event parseable by sync router', async () => {
    const adapter = createFileBackedAdapter()
    const user = LOCAL_DEFAULT_USER
    const project = await adapter.services.projects.create('Import', { ownerUserId: user.id })

    const events: unknown[] = []
    const unsubscribe = projectSyncBus.subscribe((event) => {
      events.push(event)
    })

    try {
      const caller = documentsRouter.createCaller(createCallerContext({ user, adapter }))
      const result = await caller.importMany({
        projectId: project.id,
        documents: [{ title: 'good.md', markdown: '# Good\\n\\nHello' }],
        parseFailureMode: 'fail',
      })

      expect(result.status).toBe('queued')
      await waitFor(
        async () =>
          events.find((e) => (e as { type?: string }).type === 'documents.changed') ?? null,
        (event) => Boolean(event)
      )
    } finally {
      unsubscribe()
    }

    const docChanged = events.find(
      (e) => (e as { type?: string }).type === 'documents.changed'
    ) as unknown
    expect(docChanged).toBeTruthy()
    const parsed = projectSyncEventSchema.parse(docChanged)
    expect(parsed.type).toBe('documents.changed')
    if (parsed.type === 'documents.changed') {
      expect(parsed.reason).toBe('documents.import-many')
    }
  })

  test('importSplit plans and imports multiple parts on the server', async () => {
    const adapter = createFileBackedAdapter()
    const user = LOCAL_DEFAULT_USER
    const project = await adapter.services.projects.create('Split Import', { ownerUserId: user.id })

    const caller = documentsRouter.createCaller(createCallerContext({ user, adapter }))
    const markdown = ['# Part One', '', 'Body one', '', '# Part Two', '', 'Body two'].join('\n')

    const result = await caller.importSplit({
      projectId: project.id,
      fileName: 'book.md',
      markdown,
      destinationDirectory: '',
      split: 'heading',
      headingLevel: 1,
      targetDocChars: 100,
      includeContents: true,
    })

    expect(result.status).toBe('queued')
    expect(result.total).toBe(3)

    const docs = await waitFor(
      () => adapter.services.documents.listForProject(project.id),
      (items) => items.length === 3
    )
    const titles = docs.map((doc) => doc.title)
    expect(titles.some((title) => title.endsWith('/00-contents.md'))).toBe(true)
    expect(titles.some((title) => title.endsWith('/1-part-one.md'))).toBe(true)
    expect(titles.some((title) => title.endsWith('/2-part-two.md'))).toBe(true)
  })
})
