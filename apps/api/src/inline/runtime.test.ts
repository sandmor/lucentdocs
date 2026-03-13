import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { docs } from '@y/websocket-server/utils'
import { schema, type JsonObject } from '@lucentdocs/shared'
import { createTestAdapter, type TestAdapter } from '../testing/factory.js'
import { createYjsRuntime, type YjsRuntime } from '../yjs/runtime.js'
import { createInlineRuntime, type InlineRuntime } from './runtime.js'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('InlineRuntime', () => {
  let adapter: TestAdapter
  let yjsRuntime: YjsRuntime
  let inlineRuntime: InlineRuntime

  beforeEach(() => {
    adapter = createTestAdapter()
    yjsRuntime = createYjsRuntime(
      {
        yjsDocuments: adapter.repositories.yjsDocuments,
        versionSnapshots: adapter.repositories.versionSnapshots,
      },
      { persistenceFlushIntervalMs: 1000, versionSnapshotIntervalMs: 0 }
    )
    yjsRuntime.initialize()
    inlineRuntime = createInlineRuntime(
      adapter.services,
      {
        documents: adapter.repositories.documents,
        projectDocuments: adapter.repositories.projectDocuments,
        yjsDocuments: adapter.repositories.yjsDocuments,
      },
      yjsRuntime
    )
  })

  afterEach(async () => {
    await yjsRuntime.shutdown()
  })

  function extractDocText(json: unknown): string {
    const doc = schema.nodeFromJSON(json as Record<string, unknown>)
    return doc.textBetween(0, doc.content.size, '\n\n', '\n')
  }

  test('continues writing into the live Yjs document without an observer', async () => {
    const project = await adapter.services.projects.create('Story', {
      ownerUserId: 'user_1',
    })
    const document = await adapter.services.documents.createForProject(project.id, 'chapter-01.md')

    if (!document) {
      throw new Error('Expected a project document to be created.')
    }

    const sessionId = 'inline_session_1'
    const docJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Once ' },
            {
              type: 'ai_zone',
              attrs: {
                id: 'zone_1',
                streaming: true,
                sessionId,
                originalSlice: null,
              },
            },
          ],
        },
      ],
    } as JsonObject

    await yjsRuntime.replaceLiveDocumentContent(document.id, docJson)

    await inlineRuntime.startGeneration({
      mode: 'continue',
      projectId: project.id,
      documentId: document.id,
      sessionId,
      selectionFrom: 0,
      selectionTo: 0,
      requesterClientName: 'test_client',
    })

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (
        !inlineRuntime.isGenerating({ projectId: project.id, documentId: document.id, sessionId })
      ) {
        break
      }
      await sleep(10)
    }

    const live = await yjsRuntime.getDocumentProsemirrorJson(document.id)
    expect(extractDocText(live)).toBe('Once spark')

    const content = schema.nodeFromJSON(live)
    const aiZones: boolean[] = []
    content.descendants((node) => {
      if (node.type === schema.nodes.ai_zone) {
        aiZones.push(Boolean(node.attrs.streaming))
      }
      return true
    })
    expect(aiZones).toEqual([false])
  })

  test('continues writing after the live Yjs document is evicted mid-generation', async () => {
    const previousDelay = process.env.LUCENTDOCS_TEST_INLINE_DELAY_MS
    process.env.LUCENTDOCS_TEST_INLINE_DELAY_MS = '50'

    try {
      const project = await adapter.services.projects.create('Story', {
        ownerUserId: 'user_1',
      })
      const document = await adapter.services.documents.createForProject(
        project.id,
        'chapter-02.md'
      )

      if (!document) {
        throw new Error('Expected a project document to be created.')
      }

      const sessionId = 'inline_session_2'
      await yjsRuntime.replaceLiveDocumentContent(document.id, {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Once ' },
              {
                type: 'ai_zone',
                attrs: {
                  id: 'zone_2',
                  streaming: true,
                  sessionId,
                  originalSlice: null,
                },
              },
            ],
          },
        ],
      })

      await inlineRuntime.startGeneration({
        mode: 'continue',
        projectId: project.id,
        documentId: document.id,
        sessionId,
        selectionFrom: 0,
        selectionTo: 0,
        requesterClientName: 'test_client',
      })

      await yjsRuntime.flushAllDocumentStates()

      const liveDoc = docs.get(document.id)
      liveDoc?.destroy()
      docs.delete(document.id)

      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (
          !inlineRuntime.isGenerating({ projectId: project.id, documentId: document.id, sessionId })
        ) {
          break
        }
        await sleep(10)
      }

      const live = await yjsRuntime.getDocumentProsemirrorJson(document.id)
      expect(extractDocText(live)).toBe('Once spark')
    } finally {
      if (previousDelay === undefined) {
        delete process.env.LUCENTDOCS_TEST_INLINE_DELAY_MS
      } else {
        process.env.LUCENTDOCS_TEST_INLINE_DELAY_MS = previousDelay
      }
    }
  })

  test('does not recreate a removed continuation zone without a document reload', async () => {
    const previousDelay = process.env.LUCENTDOCS_TEST_INLINE_DELAY_MS
    process.env.LUCENTDOCS_TEST_INLINE_DELAY_MS = '50'

    try {
      const project = await adapter.services.projects.create('Story', {
        ownerUserId: 'user_1',
      })
      const document = await adapter.services.documents.createForProject(
        project.id,
        'chapter-03.md'
      )

      if (!document) {
        throw new Error('Expected a project document to be created.')
      }

      const sessionId = 'inline_session_3'
      await yjsRuntime.replaceLiveDocumentContent(document.id, {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Once ' },
              {
                type: 'ai_zone',
                attrs: {
                  id: 'zone_3',
                  streaming: true,
                  sessionId,
                  originalSlice: null,
                },
              },
            ],
          },
        ],
      } as JsonObject)

      await inlineRuntime.startGeneration({
        mode: 'continue',
        projectId: project.id,
        documentId: document.id,
        sessionId,
        selectionFrom: 0,
        selectionTo: 0,
        requesterClientName: 'test_client',
      })

      await yjsRuntime.applyProsemirrorTransform(document.id, {
        transform: () => ({
          changed: true,
          nextDoc: schema.nodeFromJSON({
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Once ' }],
              },
            ],
          } as JsonObject),
          result: null,
        }),
      })

      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (
          !inlineRuntime.isGenerating({ projectId: project.id, documentId: document.id, sessionId })
        ) {
          break
        }
        await sleep(10)
      }

      const live = await yjsRuntime.getDocumentProsemirrorJson(document.id)
      expect(extractDocText(live)).toBe('Once ')
    } finally {
      if (previousDelay === undefined) {
        delete process.env.LUCENTDOCS_TEST_INLINE_DELAY_MS
      } else {
        process.env.LUCENTDOCS_TEST_INLINE_DELAY_MS = previousDelay
      }
    }
  })

  test('recreates a removed continuation zone after a document replacement even when prompt context is truncated', async () => {
    const previousDelay = process.env.LUCENTDOCS_TEST_INLINE_DELAY_MS
    process.env.LUCENTDOCS_TEST_INLINE_DELAY_MS = '50'

    try {
      const project = await adapter.services.projects.create('Story', {
        ownerUserId: 'user_1',
      })
      const document = await adapter.services.documents.createForProject(
        project.id,
        'chapter-04.md'
      )

      if (!document) {
        throw new Error('Expected a project document to be created.')
      }

      const sessionId = 'inline_session_4'
      const bigPrefix = `PROLOGUE ${'x'.repeat(20_000)} `
      const beforeZoneText = `${bigPrefix}Once `

      await yjsRuntime.replaceLiveDocumentContent(document.id, {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: beforeZoneText },
              {
                type: 'ai_zone',
                attrs: {
                  id: 'zone_4',
                  streaming: true,
                  sessionId,
                  originalSlice: null,
                },
              },
            ],
          },
        ],
      } as JsonObject)

      await inlineRuntime.startGeneration({
        mode: 'continue',
        projectId: project.id,
        documentId: document.id,
        sessionId,
        selectionFrom: 0,
        selectionTo: 0,
        requesterClientName: 'test_client',
      })

      // Replace the document to simulate a restore/reload that removes the continuation zone.
      // This bumps the Yjs epoch so the runtime is allowed to attempt zone recovery.
      await yjsRuntime.replaceDocument(
        document.id,
        {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: beforeZoneText }],
            },
          ],
        } as JsonObject,
        { evictLive: true }
      )

      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (
          !inlineRuntime.isGenerating({ projectId: project.id, documentId: document.id, sessionId })
        ) {
          break
        }
        await sleep(10)
      }

      const live = await yjsRuntime.getDocumentProsemirrorJson(document.id)
      expect(extractDocText(live).endsWith('Once spark')).toBe(true)
    } finally {
      if (previousDelay === undefined) {
        delete process.env.LUCENTDOCS_TEST_INLINE_DELAY_MS
      } else {
        process.env.LUCENTDOCS_TEST_INLINE_DELAY_MS = previousDelay
      }
    }
  })
})
