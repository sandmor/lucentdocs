import { afterEach, describe, expect, test } from 'bun:test'
import {
  INLINE_AI_MAX_ZONE_CHOICES,
  parseInlineZoneWriteAction,
  type InlineZoneWriteAction,
} from '@lucentdocs/shared'
import { configManager } from '../config/runtime.js'
import { configureEmbeddingProvider, resetEmbeddingClient } from '../embeddings/provider.js'
import { createTestAdapter } from '../testing/factory.js'
import { toEditorContent } from '../testing/editor-content.js'
import { buildInlineZoneWriteTools, buildReadTools, hasValidToolScope } from './tools.js'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

async function initializeEmbeddingSelection(
  adapter: ReturnType<typeof createTestAdapter>
): Promise<void> {
  await adapter.services.aiSettings.initializeDefaults({
    env: {
      AI_PROVIDER: 'openrouter',
      AI_BASE_URL: OPENROUTER_BASE_URL,
      AI_MODEL: 'gpt-5',
      AI_API_KEY: 'test-key',
    },
  })
  configureEmbeddingProvider(adapter.services.aiSettings, {
    fetchImpl: (async () => {
      return new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    }) as unknown as typeof fetch,
  })
}

describe('buildInlineZoneWriteTools', () => {
  test('write_zone normalizes omitted offsets to a zero-width insert', async () => {
    const actions: InlineZoneWriteAction[] = []
    const tools = buildInlineZoneWriteTools({
      onWriteAction: (action) => {
        actions.push(action)
      },
    })
    const execute = tools.write_zone.execute as
      | ((input: { fromOffset?: number; toOffset?: number; content: string }) => Promise<{
          ok: boolean
          applied: InlineZoneWriteAction
        }>)
      | undefined
    expect(execute).toBeDefined()
    if (!execute) return

    const result = await execute({ content: 'alpha' })
    const applied = actions[0]
    expect(applied).toEqual({
      type: 'replace_range',
      fromOffset: 0,
      toOffset: 0,
      content: 'alpha',
    })

    expect(result).toEqual({
      ok: true,
      applied,
    })
  })

  test('write_zone_choices trims, deduplicates, and caps alternatives', async () => {
    const actions: InlineZoneWriteAction[] = []
    const tools = buildInlineZoneWriteTools({
      onWriteAction: (action) => {
        actions.push(action)
      },
    })
    const execute = tools.write_zone_choices.execute as
      | ((input: { choices: string[] }) => Promise<{ ok: boolean; applied: InlineZoneWriteAction }>)
      | undefined
    expect(execute).toBeDefined()
    if (!execute) return

    const rawChoices = Array.from({ length: INLINE_AI_MAX_ZONE_CHOICES + 3 }, (_, index) =>
      index % 2 === 0 ? `  Choice ${index % 4}  ` : `Choice ${index % 4}`
    )

    const result = await execute({ choices: rawChoices })
    const applied = actions[0]
    expect(applied?.type).toBe('set_choices')
    const appliedChoices = applied && applied.type === 'set_choices' ? applied.choices : []
    expect(appliedChoices.length).toBeLessThanOrEqual(INLINE_AI_MAX_ZONE_CHOICES)
    expect(appliedChoices).toEqual(['Choice 0', 'Choice 1', 'Choice 2', 'Choice 3'])
    expect(result).toEqual({
      ok: true,
      applied,
    })
  })
})

describe('parseInlineZoneWriteAction', () => {
  test('returns null for invalid offset ranges', () => {
    expect(
      parseInlineZoneWriteAction({
        type: 'replace_range',
        fromOffset: 8,
        toOffset: 3,
        content: 'bad',
      })
    ).toBeNull()
  })

  test('normalizes choices action payloads', () => {
    const parsed = parseInlineZoneWriteAction({
      type: 'set_choices',
      choices: ['  A  ', 'A', 'B', '', '  '],
    })

    expect(parsed).toEqual({
      type: 'set_choices',
      choices: ['A', 'B'],
    })
  })
})

describe('hasValidToolScope', () => {
  test('requires both project and document identifiers', () => {
    expect(hasValidToolScope({ projectId: 'a' })).toBe(false)
    expect(hasValidToolScope({ documentId: 'b' })).toBe(false)
    expect(hasValidToolScope({ projectId: 'a', documentId: 'b' })).toBe(true)
  })
})

describe('buildReadTools', () => {
  afterEach(() => {
    resetEmbeddingClient()
  })

  test('search_file returns semantic matches for the active document', async () => {
    const adapter = createTestAdapter()
    await initializeEmbeddingSelection(adapter)

    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapters/one.md',
      toEditorContent(`# Chapter One

Moonlight floods the silver forest and settles over the pines.

The town below stays dark and quiet.`)
    )

    if (!document) {
      throw new Error('Expected test document to be created.')
    }

    const now = Date.now()
    await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: document.id,
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
      documentTimestamp: now,
      contentHash: 'chapter-one-hash',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 58,
          selectionFrom: 16,
          selectionTo: 74,
          text: 'Moonlight floods the silver forest and settles over the pines.',
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

    const tools = buildReadTools({
      scope: {
        projectId: project.id,
        documentId: document.id,
      },
      services: adapter.services,
    })
    const execute = tools.search_file.execute as
      | ((input: { query: string; limit?: number }) => Promise<{
          path: string
          indexing: { type: string; description: string } | null
          semantic_matches: Array<{ match_type: string; preview: string }>
          notes: string[]
        }>)
      | undefined

    expect(execute).toBeDefined()
    if (!execute) return

    const result = await execute({ query: 'silver forest', limit: 3 })

    expect(result.path).toBe('chapters/one.md')
    expect(result.indexing?.type).toBe('sliding_window')
    expect(result.indexing?.description).toContain('Sliding window')
    expect(result.semantic_matches[0]?.match_type).toBe('snippet')
    expect(result.semantic_matches[0]?.preview.toLowerCase()).toContain('silver forest')
    expect(result.notes[0]).toContain('bounded local excerpt')
  })

  test('search_project returns project-wide matches with indexing metadata', async () => {
    const adapter = createTestAdapter()
    await initializeEmbeddingSelection(adapter)

    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const chapterOne = await adapter.services.documents.createForProject(
      project.id,
      'chapters/one.md',
      toEditorContent(`# Chapter One

Moonlight floods the silver forest and settles over the pines.`)
    )
    const chapterTwo = await adapter.services.documents.createForProject(
      project.id,
      'chapters/two.md',
      toEditorContent(`# Chapter Two

The copper city wakes at dawn while market bells echo through the square.`)
    )

    if (!chapterOne || !chapterTwo) {
      throw new Error('Expected test documents to be created.')
    }

    const now = Date.now()
    await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: chapterOne.id,
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
      documentTimestamp: now,
      contentHash: 'chapter-one-project-search',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 58,
          selectionFrom: 16,
          selectionTo: 74,
          text: 'Moonlight floods the silver forest and settles over the pines.',
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })
    await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: chapterTwo.id,
      providerConfigId: null,
      providerId: 'openrouter',
      type: 'openrouter',
      baseURL: OPENROUTER_BASE_URL,
      model: 'openai/text-embedding-3-small',
      strategy: { type: 'whole_document', properties: {} },
      documentTimestamp: now + 1,
      contentHash: 'chapter-two-project-search',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 72,
          text: 'The copper city wakes at dawn while market bells echo through the square.',
          embedding: [0.11, 0.2, 0.29],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

    const tools = buildReadTools({
      scope: {
        projectId: project.id,
        documentId: chapterOne.id,
      },
      services: adapter.services,
    })
    const execute = tools.search_project.execute as
      | ((input: { query: string; limit?: number }) => Promise<{
          results: Array<{
            path: string
            match_type: string
            indexing: { type: string; description: string } | null
            snippets: Array<{ preview: string }>
          }>
          notes: string[]
        }>)
      | undefined

    expect(execute).toBeDefined()
    if (!execute) return

    const result = await execute({ query: 'silver forest', limit: 5 })

    expect(result.results[0]?.path).toBe('chapters/one.md')
    expect(result.results[0]?.indexing?.type).toBe('sliding_window')
    expect(result.results[0]?.snippets[0]?.preview.toLowerCase()).toContain('silver forest')
    expect(result.notes[0]).toContain('read_file')
  })

  test('search tools reject queries that exceed the configured max length', async () => {
    const adapter = createTestAdapter()
    await initializeEmbeddingSelection(adapter)

    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapters/one.md',
      toEditorContent('Short content for validation.')
    )

    if (!document) {
      throw new Error('Expected test document to be created.')
    }

    const tools = buildReadTools({
      scope: {
        projectId: project.id,
        documentId: document.id,
      },
      services: adapter.services,
    })
    const execute = tools.search_file.execute as
      | ((input: { query: string; limit?: number }) => Promise<unknown>)
      | undefined

    expect(execute).toBeDefined()
    if (!execute) return

    const maxQueryChars = configManager.getConfig().search.maxQueryChars
    await expect(execute({ query: 'x'.repeat(maxQueryChars + 10) })).rejects.toThrow(
      'Search query exceeds maximum length'
    )
  })

  test('search_project resolves indexing consistently for sole and shared documents', async () => {
    const adapter = createTestAdapter()
    await initializeEmbeddingSelection(adapter)

    const projectA = await adapter.services.projects.create('Project A', { ownerUserId: 'owner_1' })
    const projectB = await adapter.services.projects.create('Project B', { ownerUserId: 'owner_2' })

    const soleDoc = await adapter.services.documents.createForProject(
      projectA.id,
      'chapters/sole.md',
      toEditorContent('Moonlight settles over the valley and lights every stone.')
    )
    const sharedDoc = await adapter.services.documents.createForProject(
      projectA.id,
      'chapters/shared.md',
      toEditorContent('Moonlight reaches the bridge and glows across the river.')
    )

    if (!soleDoc || !sharedDoc) {
      throw new Error('Expected test documents to be created.')
    }

    await adapter.repositories.projectDocuments.insert({
      projectId: projectB.id,
      documentId: sharedDoc.id,
      addedAt: Date.now(),
    })

    await adapter.services.indexingSettings.updateProjectStrategy(projectA.id, {
      type: 'whole_document',
      properties: {},
    })
    await adapter.services.indexingSettings.updateUserStrategy('owner_1', {
      type: 'whole_document',
      properties: {},
    })

    const now = Date.now()
    await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: soleDoc.id,
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
      documentTimestamp: now,
      contentHash: 'sole-doc-indexing',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 64,
          selectionFrom: 0,
          selectionTo: 64,
          text: 'Moonlight settles over the valley and lights every stone.',
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

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
      documentTimestamp: now + 1,
      contentHash: 'shared-doc-indexing',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 62,
          selectionFrom: 0,
          selectionTo: 62,
          text: 'Moonlight reaches the bridge and glows across the river.',
          embedding: [0.11, 0.19, 0.31],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

    const tools = buildReadTools({
      scope: {
        projectId: projectA.id,
        documentId: soleDoc.id,
      },
      services: adapter.services,
    })
    const execute = tools.search_project.execute as
      | ((input: { query: string; limit?: number }) => Promise<{
          results: Array<{
            path: string
            indexing: { type: string } | null
          }>
        }>)
      | undefined

    expect(execute).toBeDefined()
    if (!execute) return

    const result = await execute({ query: 'moonlight', limit: 10 })
    const resultByPath = new Map(result.results.map((entry) => [entry.path, entry]))

    expect(resultByPath.get('chapters/sole.md')?.indexing?.type).toBe('whole_document')
    expect(resultByPath.get('chapters/shared.md')?.indexing?.type).toBe('sliding_window')
  })
})
