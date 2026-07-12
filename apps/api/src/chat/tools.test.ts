import { afterEach, describe, expect, test } from 'bun:test'
import {
  INLINE_AI_MAX_ZONE_CHOICES,
  parseContent,
  parseInlineZoneWriteAction,
  schema,
  type InlineZoneWriteAction,
} from '@lucentdocs/shared'
import { configManager } from '../config/runtime.js'
import {
  configureEmbeddingModelSelection,
  configureEmbeddingProvider,
  resetEmbeddingClient,
} from '../embeddings/provider.js'
import { createTestAdapter } from '../testing/factory.js'
import { toEditorContent } from '../testing/editor-content.js'
import {
  GLOB_DESCRIPTION,
  GREP_DESCRIPTION,
  EDIT_DESCRIPTION,
  READ_DESCRIPTION,
  SEARCH_DESCRIPTION,
} from './tools/descriptions/index.js'
import {
  buildEditTools,
  buildInlineZoneWriteTools,
  buildReadTools,
  hasValidToolScope,
} from './tools.js'
import { DocumentEditSession } from './tools/document-edit-session.js'
import { createYjsRuntime, type YjsRuntime } from '../yjs/runtime.js'
import {
  createEmptyChatThreadPayload,
  serializeThreadPayload,
} from '../core/services/chat-thread-payload.js'

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
  configureEmbeddingModelSelection(adapter.services.embeddingModelSelection)
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

describe('agent tool descriptions', () => {
  test('include routing guidance for sibling tools', () => {
    expect(READ_DESCRIPTION).toContain('grep')
    expect(READ_DESCRIPTION).toContain('glob')
    expect(READ_DESCRIPTION).toContain('search')
    expect(READ_DESCRIPTION).toContain('annotation')
    expect(GLOB_DESCRIPTION).toContain('read')
    expect(GREP_DESCRIPTION).toContain('search')
    expect(SEARCH_DESCRIPTION).toContain('whole_project')
    expect(SEARCH_DESCRIPTION).toContain('active file')
    expect(EDIT_DESCRIPTION).toContain('read')
    expect(EDIT_DESCRIPTION).toContain('annotation')
    expect(READ_DESCRIPTION.length).toBeGreaterThan(200)
  })
})

describe('buildReadTools', () => {
  afterEach(() => {
    resetEmbeddingClient()
  })

  test('search returns semantic matches for a scoped file path', async () => {
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
    const execute = tools.search.execute as
      | ((input: { query: string; path?: string; limit?: number }) => Promise<{
          path?: string
          matches: Array<{
            path: string
            match_type: string
            preview: string
            relevance_score: number
            start_line: number | null
          }>
          meta: { suggested_next?: string; semantic_unavailable?: boolean }
        }>)
      | undefined

    expect(execute).toBeDefined()
    if (!execute) return

    const result = await execute({ query: 'silver forest', path: 'chapters/one.md', limit: 3 })

    expect(result.path).toBe('chapters/one.md')
    expect(result.matches[0]?.match_type).toBe('snippet')
    expect(result.matches[0]?.preview.toLowerCase()).toContain('silver forest')
    expect(result.matches[0]?.relevance_score).toBeGreaterThan(0)
    expect(result.meta.suggested_next).toBe('read')
  })

  test('search without path defaults to the active file', async () => {
    const adapter = createTestAdapter()
    await initializeEmbeddingSelection(adapter)

    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const active = await adapter.services.documents.createForProject(
      project.id,
      'chapters/active.md',
      toEditorContent('Moonlight floods the silver forest in the active chapter.')
    )
    const other = await adapter.services.documents.createForProject(
      project.id,
      'chapters/other.md',
      toEditorContent('The copper city wakes at dawn.')
    )

    if (!active || !other) {
      throw new Error('Expected test documents to be created.')
    }

    const now = Date.now()
    for (const [documentId, text, hash] of [
      [active.id, 'Moonlight floods the silver forest in the active chapter.', 'active-hash'],
      [other.id, 'The copper city wakes at dawn.', 'other-hash'],
    ] as const) {
      await adapter.repositories.documentEmbeddings.replaceEmbeddings({
        documentId,
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
        contentHash: hash,
        chunks: [
          {
            ordinal: 0,
            start: 0,
            end: text.length,
            selectionFrom: 0,
            selectionTo: text.length,
            text,
            embedding: [0.1, 0.2, 0.3],
          },
        ],
        createdAt: now,
        updatedAt: now,
      })
    }

    const tools = buildReadTools({
      scope: { projectId: project.id, documentId: active.id },
      services: adapter.services,
    })
    const execute = tools.search.execute as
      | ((input: { query: string }) => Promise<{ path?: string; matches: Array<{ path: string }> }>)
      | undefined

    expect(execute).toBeDefined()
    if (!execute) return

    const result = await execute({ query: 'silver forest' })
    expect(result.path).toBe('chapters/active.md')
    expect(result.matches.every((match) => match.path === 'chapters/active.md')).toBe(true)
  })

  test('read includes annotation markers and annotation bodies by default', async () => {
    const adapter = createTestAdapter()
    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapters/annotated.md',
      toEditorContent(`First paragraph.

Second paragraph.`)
    )

    if (!document) {
      throw new Error('Expected test document to be created.')
    }

    const storedDocument = await adapter.services.documents.getForProject(project.id, document.id)
    if (!storedDocument) {
      throw new Error('Expected stored document to be readable.')
    }

    const parsed = parseContent(storedDocument.content)
    const storedDocNode = schema.nodeFromJSON(parsed.doc)
    const firstBlockId = storedDocNode.child(0).attrs.id
    if (typeof firstBlockId !== 'string') {
      throw new Error('Expected first block to have an id.')
    }

    await adapter.repositories.documentNotes.replaceAllForDocument(document.id, [
      {
        id: 'note_1',
        documentId: document.id,
        anchorKind: 'block',
        anchorId: firstBlockId,
        content: JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Use this hidden context.' }],
            },
          ],
        }),
        authorUserId: 'owner_1',
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    const tools = buildReadTools({
      scope: {
        projectId: project.id,
        documentId: document.id,
      },
      services: adapter.services,
    })
    const execute = tools.read.execute as
      | ((input: {
          path: string
          offset?: number
          limit?: number
          include_annotations?: boolean
        }) => Promise<{
          kind: string
          output: string
        }>)
      | undefined

    expect(execute).toBeDefined()
    if (!execute) return

    const result = await execute({ path: 'chapters/annotated.md' })

    expect(result.kind).toBe('file')
    expect(result.output).toContain('<annotation id="n1">')
    expect(result.output).toContain('First paragraph.')
    expect(result.output).toContain('<annotations>')
    expect(result.output).toContain('Use this hidden context.')
  })

  test('read scopes annotations to the returned line slice', async () => {
    const adapter = createTestAdapter()
    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapters/annotated.md',
      toEditorContent(`First paragraph.

Second paragraph.`)
    )

    if (!document) {
      throw new Error('Expected test document to be created.')
    }

    const storedDocument = await adapter.services.documents.getForProject(project.id, document.id)
    if (!storedDocument) {
      throw new Error('Expected stored document to be readable.')
    }

    const parsed = parseContent(storedDocument.content)
    const storedDocNode = schema.nodeFromJSON(parsed.doc)
    const firstBlockId = storedDocNode.child(0).attrs.id
    if (typeof firstBlockId !== 'string') {
      throw new Error('Expected first block to have an id.')
    }

    await adapter.repositories.documentNotes.replaceAllForDocument(document.id, [
      {
        id: 'note_1',
        documentId: document.id,
        anchorKind: 'block',
        anchorId: firstBlockId,
        content: JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Use this hidden context.' }],
            },
          ],
        }),
        authorUserId: 'owner_1',
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    const tools = buildReadTools({
      scope: {
        projectId: project.id,
        documentId: document.id,
      },
      services: adapter.services,
    })
    const execute = tools.read.execute as
      | ((input: { path: string; offset?: number; limit?: number }) => Promise<{
          output: string
        }>)
      | undefined

    expect(execute).toBeDefined()
    if (!execute) return

    const fullResult = await execute({ path: 'chapters/annotated.md' })
    const fullLines = fullResult.output.split('\n')
    const secondParagraphLine =
      fullLines.findIndex((line) => line.includes('Second paragraph.')) + 1

    expect(secondParagraphLine).toBeGreaterThan(0)

    const excluded = await execute({
      path: 'chapters/annotated.md',
      offset: secondParagraphLine,
      limit: 1,
    })
    expect(excluded.output).not.toContain('n1')
    expect(excluded.output).not.toContain('<annotations>')
  })

  test('read lists directory entries with trailing slashes', async () => {
    const adapter = createTestAdapter()
    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapters/one.md',
      toEditorContent('Chapter body')
    )

    if (!document) {
      throw new Error('Expected test document to be created.')
    }

    const tools = buildReadTools({
      scope: { projectId: project.id, documentId: document.id },
      services: adapter.services,
    })
    const execute = tools.read.execute as
      | ((input: { path: string }) => Promise<{ kind: string; output: string; entries: string[] }>)
      | undefined

    expect(execute).toBeDefined()
    if (!execute) return

    const result = await execute({ path: '/' })
    expect(result.kind).toBe('directory')
    expect(result.entries.some((entry) => entry === 'chapters/')).toBe(true)
    expect(result.output).toContain('chapters/')
  })

  test('glob returns matching project paths', async () => {
    const adapter = createTestAdapter()
    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const one = await adapter.services.documents.createForProject(
      project.id,
      'chapters/one.md',
      toEditorContent('one')
    )
    const two = await adapter.services.documents.createForProject(
      project.id,
      'notes/two.md',
      toEditorContent('two')
    )

    if (!one || !two) {
      throw new Error('Expected test documents to be created.')
    }

    const tools = buildReadTools({
      scope: { projectId: project.id, documentId: one.id },
      services: adapter.services,
    })
    const execute = tools.glob.execute as
      | ((input: { pattern: string }) => Promise<{ paths: string[] }>)
      | undefined

    expect(execute).toBeDefined()
    if (!execute) return

    const result = await execute({ pattern: 'chapters/*.md' })
    expect(result.paths).toEqual(['chapters/one.md'])
  })

  test('grep finds exact manuscript matches with line numbers', async () => {
    const adapter = createTestAdapter()
    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapters/one.md',
      toEditorContent(`# Chapter One

Moonlight floods the silver forest.`)
    )

    if (!document) {
      throw new Error('Expected test document to be created.')
    }

    const tools = buildReadTools({
      scope: { projectId: project.id, documentId: document.id },
      services: adapter.services,
    })
    const execute = tools.grep.execute as
      | ((input: { pattern: string }) => Promise<{
          matches: Array<{ line: number; text: string; source: string }>
          output: string
        }>)
      | undefined

    expect(execute).toBeDefined()
    if (!execute) return

    const result = await execute({ pattern: 'silver forest' })
    expect(result.matches[0]?.source).toBe('manuscript')
    expect(result.matches[0]?.line).toBeGreaterThan(0)
    expect(result.matches[0]?.text.toLowerCase()).toContain('silver forest')
    expect(result.output).toContain('Line')
  })

  test('search returns project-wide matches with relevance scores', async () => {
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
    const execute = tools.search.execute as
      | ((input: { query: string; whole_project?: boolean; limit?: number }) => Promise<{
          matches: Array<{
            path: string
            match_type: string
            preview: string
            relevance_score: number
          }>
          meta: { suggested_next?: string }
        }>)
      | undefined

    expect(execute).toBeDefined()
    if (!execute) return

    const result = await execute({ query: 'silver forest', whole_project: true, limit: 5 })

    expect(result.matches[0]?.path).toBe('chapters/one.md')
    expect(result.matches[0]?.preview.toLowerCase()).toContain('silver forest')
    expect(result.matches[0]?.relevance_score).toBeGreaterThan(0)
    expect(result.meta.suggested_next).toBe('read')
  })

  test('search rejects queries that exceed the configured max length', async () => {
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
    const execute = tools.search.execute as
      | ((input: { query: string; limit?: number }) => Promise<unknown>)
      | undefined

    expect(execute).toBeDefined()
    if (!execute) return

    const maxQueryChars = configManager.getConfig().search.maxQueryChars
    await expect(execute({ query: 'x'.repeat(maxQueryChars + 10) })).rejects.toThrow(
      'Search query exceeds maximum length'
    )
  })

  test('read rejects missing paths with suggestions', async () => {
    const adapter = createTestAdapter()
    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapters/one.md',
      toEditorContent('Body')
    )

    if (!document) {
      throw new Error('Expected test document to be created.')
    }

    const tools = buildReadTools({
      scope: { projectId: project.id, documentId: document.id },
      services: adapter.services,
    })
    const execute = tools.read.execute as
      | ((input: { path: string }) => Promise<unknown>)
      | undefined

    expect(execute).toBeDefined()
    if (!execute) return

    await expect(execute({ path: 'chapters/one' })).rejects.toThrow('Did you mean')
  })

  test('read can omit annotations when include_annotations is false', async () => {
    const adapter = createTestAdapter()
    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapters/annotated.md',
      toEditorContent('First paragraph.')
    )

    if (!document) {
      throw new Error('Expected test document to be created.')
    }

    const storedDocument = await adapter.services.documents.getForProject(project.id, document.id)
    if (!storedDocument) {
      throw new Error('Expected stored document to be readable.')
    }

    const parsed = parseContent(storedDocument.content)
    const storedDocNode = schema.nodeFromJSON(parsed.doc)
    const firstBlockId = storedDocNode.child(0).attrs.id
    if (typeof firstBlockId !== 'string') {
      throw new Error('Expected first block to have an id.')
    }

    await adapter.repositories.documentNotes.replaceAllForDocument(document.id, [
      {
        id: 'note_1',
        documentId: document.id,
        anchorKind: 'block',
        anchorId: firstBlockId,
        content: JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Hidden context.' }],
            },
          ],
        }),
        authorUserId: 'owner_1',
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    const tools = buildReadTools({
      scope: { projectId: project.id, documentId: document.id },
      services: adapter.services,
    })
    const execute = tools.read.execute as
      | ((input: { path: string; include_annotations?: boolean }) => Promise<{ output: string }>)
      | undefined

    expect(execute).toBeDefined()
    if (!execute) return

    const result = await execute({ path: 'chapters/annotated.md', include_annotations: false })
    expect(result.output).not.toContain('<annotation')
    expect(result.output).not.toContain('<annotations>')
    expect(result.output).toContain('First paragraph.')
  })

  test('grep rejects invalid regex patterns with a clear error', async () => {
    const adapter = createTestAdapter()
    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapters/one.md',
      toEditorContent('Moonlight floods the silver forest.')
    )

    if (!document) {
      throw new Error('Expected test document to be created.')
    }

    const tools = buildReadTools({
      scope: { projectId: project.id, documentId: document.id },
      services: adapter.services,
    })
    const execute = tools.grep.execute as
      | ((input: { pattern: string; regex?: boolean }) => Promise<unknown>)
      | undefined

    expect(execute).toBeDefined()
    if (!execute) return

    await expect(execute({ pattern: '(unclosed', regex: true })).rejects.toThrow(
      'Invalid regular expression pattern'
    )
  })

  test('search start_line aligns with read output for annotated documents', async () => {
    const adapter = createTestAdapter()
    await initializeEmbeddingSelection(adapter)

    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapters/annotated.md',
      toEditorContent(`First paragraph.

Moonlight floods the silver forest.`)
    )

    if (!document) {
      throw new Error('Expected test document to be created.')
    }

    const storedDocument = await adapter.services.documents.getForProject(project.id, document.id)
    if (!storedDocument) {
      throw new Error('Expected stored document to be readable.')
    }

    const parsed = parseContent(storedDocument.content)
    const storedDocNode = schema.nodeFromJSON(parsed.doc)
    const firstBlockId = storedDocNode.child(0).attrs.id
    if (typeof firstBlockId !== 'string') {
      throw new Error('Expected first block to have an id.')
    }

    await adapter.repositories.documentNotes.replaceAllForDocument(document.id, [
      {
        id: 'note_1',
        documentId: document.id,
        anchorKind: 'block',
        anchorId: firstBlockId,
        content: JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Hidden context.' }],
            },
          ],
        }),
        authorUserId: 'owner_1',
        createdAt: 1,
        updatedAt: 1,
      },
    ])

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
      contentHash: 'annotated-search-alignment',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 34,
          selectionFrom: 18,
          selectionTo: 52,
          text: 'Moonlight floods the silver forest.',
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

    const tools = buildReadTools({
      scope: { projectId: project.id, documentId: document.id },
      services: adapter.services,
    })
    const searchExecute = tools.search.execute as
      | ((input: { query: string; path: string }) => Promise<{
          matches: Array<{ start_line: number | null }>
        }>)
      | undefined
    const readExecute = tools.read.execute as
      | ((input: { path: string; offset?: number; limit?: number }) => Promise<{
          output: string
        }>)
      | undefined

    expect(searchExecute).toBeDefined()
    expect(readExecute).toBeDefined()
    if (!searchExecute || !readExecute) return

    const searchResult = await searchExecute({
      query: 'silver forest',
      path: 'chapters/annotated.md',
    })
    const startLine = searchResult.matches[0]?.start_line
    expect(startLine).toBeGreaterThan(0)

    const readResult = await readExecute({
      path: 'chapters/annotated.md',
      offset: startLine ?? 1,
      limit: 3,
    })
    expect(readResult.output.toLowerCase()).toContain('silver forest')
  })
})

function createTestYjsRuntime(adapter: ReturnType<typeof createTestAdapter>): YjsRuntime {
  const yjsRuntime = createYjsRuntime(
    {
      yjsDocuments: adapter.repositories.yjsDocuments,
      versionSnapshots: adapter.repositories.versionSnapshots,
      documentContent: adapter.repositories.documentContent,
      documentNotes: adapter.repositories.documentNotes,
    },
    { persistenceFlushIntervalMs: 1000, versionSnapshotIntervalMs: 0 }
  )
  yjsRuntime.initialize()
  return yjsRuntime
}

function createEditContext(
  adapter: ReturnType<typeof createTestAdapter>,
  projectId: string,
  documentId: string,
  yjsRuntime: YjsRuntime
) {
  const editSession = new DocumentEditSession()
  return {
    scope: { projectId, documentId },
    services: adapter.services,
    yjsRuntime,
    editSession,
  }
}

describe('buildEditTools', () => {
  test('edit rejects paths that were not read in this generation', async () => {
    const adapter = createTestAdapter()
    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapters/edit-me.md',
      toEditorContent('Alpha beta gamma.')
    )
    if (!document) throw new Error('Expected test document to be created.')

    const tools = buildEditTools(
      createEditContext(adapter, project.id, document.id, createTestYjsRuntime(adapter))
    )
    const execute = tools.edit.execute as
      | ((input: { path: string; old_string: string; new_string: string }) => Promise<unknown>)
      | undefined
    expect(execute).toBeDefined()
    if (!execute) return

    await expect(
      execute({
        path: 'chapters/edit-me.md',
        old_string: 'Alpha',
        new_string: 'Omega',
      })
    ).rejects.toThrow(/must call read/)
  })

  test('edit applies manuscript replacements after read and preserves content', async () => {
    const adapter = createTestAdapter()
    const yjsRuntime = createTestYjsRuntime(adapter)
    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapters/edit-me.md',
      toEditorContent('Alpha beta gamma.')
    )
    if (!document) throw new Error('Expected test document to be created.')

    const context = createEditContext(adapter, project.id, document.id, yjsRuntime)
    const readTools = buildReadTools(context)
    const editTools = buildEditTools(context)

    const readExecute = readTools.read.execute as
      | ((input: { path: string }) => Promise<unknown>)
      | undefined
    const editExecute = editTools.edit.execute as
      | ((input: {
          path: string
          old_string: string
          new_string: string
        }) => Promise<{ replacements: number; output: string }>)
      | undefined

    expect(readExecute).toBeDefined()
    expect(editExecute).toBeDefined()
    if (!readExecute || !editExecute) return

    await readExecute({ path: 'chapters/edit-me.md' })
    const result = await editExecute({
      path: 'chapters/edit-me.md',
      old_string: 'Alpha',
      new_string: 'Omega',
    })

    expect(result.replacements).toBe(1)
    expect(result.output).toContain('Edit applied successfully')

    const updated = await adapter.services.documents.getForProject(project.id, document.id)
    expect(updated?.content).toContain('Omega beta gamma')
  })

  test('edit matches manuscript text when old_string uses ASCII quotes in a curly-quote document', async () => {
    const adapter = createTestAdapter()
    const yjsRuntime = createTestYjsRuntime(adapter)
    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const curlyLine = '“What kind of life?” he asked, though he already felt the answer.'
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapters/curly.md',
      toEditorContent(`${curlyLine}\n\nSecond paragraph.`)
    )
    if (!document) throw new Error('Expected test document to be created.')

    const context = createEditContext(adapter, project.id, document.id, yjsRuntime)

    const readExecute = buildReadTools(context).read.execute as
      | ((input: { path: string }) => Promise<unknown>)
      | undefined
    const editExecute = buildEditTools(context).edit.execute as
      | ((input: {
          path: string
          old_string: string
          new_string: string
        }) => Promise<{ replacements: number }>)
      | undefined

    expect(readExecute).toBeDefined()
    expect(editExecute).toBeDefined()
    if (!readExecute || !editExecute) return

    await readExecute({ path: 'chapters/curly.md' })
    const result = await editExecute({
      path: 'chapters/curly.md',
      old_string: '"What kind of life?" he asked, though he already felt the answer.',
      new_string: '"What kind of life?" she asked, though she already felt the answer.',
    })

    expect(result.replacements).toBe(1)

    const updated = await adapter.services.documents.getForProject(project.id, document.id)
    expect(updated?.content).toContain('she asked')
  })

  test('edit rejects ambiguous multi-match without replace_all', async () => {
    const adapter = createTestAdapter()
    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapters/repeat.md',
      toEditorContent('repeat repeat at the end.')
    )
    if (!document) throw new Error('Expected test document to be created.')

    const context = createEditContext(
      adapter,
      project.id,
      document.id,
      createTestYjsRuntime(adapter)
    )
    const readExecute = buildReadTools(context).read.execute as
      | ((input: { path: string }) => Promise<unknown>)
      | undefined
    const editExecute = buildEditTools(context).edit.execute as
      | ((input: { path: string; old_string: string; new_string: string }) => Promise<unknown>)
      | undefined

    expect(readExecute).toBeDefined()
    expect(editExecute).toBeDefined()
    if (!readExecute || !editExecute) return

    await readExecute({ path: 'chapters/repeat.md' })
    await expect(
      editExecute({
        path: 'chapters/repeat.md',
        old_string: 'repeat',
        new_string: 'echo',
      })
    ).rejects.toThrow(/multiple matches/)
  })

  test('edit rejects stale reads after external content changes', async () => {
    const adapter = createTestAdapter()
    const yjsRuntime = createTestYjsRuntime(adapter)
    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapters/stale.md',
      toEditorContent('Original text here.')
    )
    if (!document) throw new Error('Expected test document to be created.')

    const context = createEditContext(adapter, project.id, document.id, yjsRuntime)
    const readExecute = buildReadTools(context).read.execute as
      | ((input: { path: string }) => Promise<unknown>)
      | undefined
    const editExecute = buildEditTools(context).edit.execute as
      | ((input: { path: string; old_string: string; new_string: string }) => Promise<unknown>)
      | undefined

    expect(readExecute).toBeDefined()
    expect(editExecute).toBeDefined()
    if (!readExecute || !editExecute) return

    await readExecute({ path: 'chapters/stale.md' })
    await yjsRuntime.replaceLiveDocumentContent(
      document.id,
      parseContent(toEditorContent('Changed elsewhere.')).doc
    )

    await expect(
      editExecute({
        path: 'chapters/stale.md',
        old_string: 'Original text here.',
        new_string: 'Edited text here.',
      })
    ).rejects.toThrow(/changed since it was last read/)
  })

  test('edit allows sequential disjoint edits after updating the session hash', async () => {
    const adapter = createTestAdapter()
    const yjsRuntime = createTestYjsRuntime(adapter)
    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapters/sequential.md',
      toEditorContent('First second third.')
    )
    if (!document) throw new Error('Expected test document to be created.')

    const context = createEditContext(adapter, project.id, document.id, yjsRuntime)
    const readExecute = buildReadTools(context).read.execute as
      | ((input: { path: string }) => Promise<unknown>)
      | undefined
    const editExecute = buildEditTools(context).edit.execute as
      | ((input: {
          path: string
          old_string: string
          new_string: string
        }) => Promise<{ replacements: number }>)
      | undefined

    expect(readExecute).toBeDefined()
    expect(editExecute).toBeDefined()
    if (!readExecute || !editExecute) return

    await readExecute({ path: 'chapters/sequential.md' })
    await editExecute({
      path: 'chapters/sequential.md',
      old_string: 'First',
      new_string: 'One',
    })
    await editExecute({
      path: 'chapters/sequential.md',
      old_string: 'third',
      new_string: 'three',
    })

    await yjsRuntime.ensureDocumentLoaded(document.id)
    const json = await yjsRuntime.getDocumentProsemirrorJson(document.id)
    expect(JSON.stringify(json)).toContain('One')
    expect(JSON.stringify(json)).toContain('three')
  })

  test('edit validation rejects reserved markup and oversized input', async () => {
    const adapter = createTestAdapter()
    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapters/validate.md',
      toEditorContent('Hello world.')
    )
    if (!document) throw new Error('Expected test document to be created.')

    const context = createEditContext(adapter, project.id, document.id, createTestYjsRuntime(adapter))
    const readExecute = buildReadTools(context).read.execute as
      | ((input: { path: string }) => Promise<unknown>)
      | undefined
    const editExecute = buildEditTools(context).edit.execute as
      | ((input: { path: string; old_string: string; new_string: string }) => Promise<unknown>)
      | undefined

    expect(readExecute).toBeDefined()
    expect(editExecute).toBeDefined()
    if (!readExecute || !editExecute) return

    await readExecute({ path: 'chapters/validate.md' })

    await expect(
      editExecute({
        path: 'chapters/validate.md',
        old_string: 'Hello',
        new_string: '<annotation id="n1">oops</annotation>',
      })
    ).rejects.toThrow(/must not contain/)

    await expect(
      editExecute({
        path: 'chapters/validate.md',
        old_string: 'x'.repeat(200_000),
        new_string: 'y',
      })
    ).rejects.toThrow(/maximum length/)
  })

  test('edit normalizes line-number and annotation wrappers from old_string', async () => {
    const adapter = createTestAdapter()
    const yjsRuntime = createTestYjsRuntime(adapter)
    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapters/normalize.md',
      toEditorContent('Hello world.')
    )
    if (!document) throw new Error('Expected test document to be created.')

    const context = createEditContext(adapter, project.id, document.id, yjsRuntime)
    const readExecute = buildReadTools(context).read.execute as
      | ((input: { path: string }) => Promise<unknown>)
      | undefined
    const editExecute = buildEditTools(context).edit.execute as
      | ((input: {
          path: string
          old_string: string
          new_string: string
        }) => Promise<{ replacements: number }>)
      | undefined

    expect(readExecute).toBeDefined()
    expect(editExecute).toBeDefined()
    if (!readExecute || !editExecute) return

    await readExecute({ path: 'chapters/normalize.md' })
    const result = await editExecute({
      path: 'chapters/normalize.md',
      old_string: '1: <annotation id="n1">\nHello world.\n</annotation>',
      new_string: 'Goodbye world.',
    })

    expect(result.replacements).toBe(1)
    const json = await yjsRuntime.getDocumentProsemirrorJson(document.id)
    expect(JSON.stringify(json)).toContain('Goodbye world.')
  })
})

describe('chats service envelope', () => {
  test('create initializes v1 payload and updateSettings persists editingEnabled', async () => {
    const adapter = createTestAdapter()
    const project = await adapter.services.projects.create('Novel', { ownerUserId: 'owner_1' })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'notes.md',
      toEditorContent('Draft')
    )
    if (!document) throw new Error('Expected test document to be created.')

    const created = await adapter.services.chats.create(project.id, document.id)
    if (!created) throw new Error('Expected chat thread to be created.')
    expect(created.settings.editingEnabled).toBe(false)

    const row = await adapter.repositories.chats.findById(project.id, document.id, created.id)
    expect(row?.messages).toBe(serializeThreadPayload(createEmptyChatThreadPayload()))

    const updated = await adapter.services.chats.updateSettings(
      project.id,
      document.id,
      created.id,
      {
        editingEnabled: true,
      }
    )
    expect(updated?.settings.editingEnabled).toBe(true)
  })
})
