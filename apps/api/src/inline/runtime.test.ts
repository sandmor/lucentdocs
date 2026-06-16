import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { docs } from '@y/websocket-server/utils'
import { schema, type InlineZoneWriteAction, type JsonObject } from '@lucentdocs/shared'
import { createTestAdapter, type TestAdapter } from '../testing/factory.js'
import { createYjsRuntime, type YjsRuntime } from '../yjs/runtime.js'
import { createInlineRuntime, type InlineRuntime } from './runtime.js'
import { applyInlineZoneWriteActionToDoc, getInlineZoneTextFromDoc } from './zone-write.js'

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
        documentContent: adapter.repositories.documentContent,
        documentNotes: adapter.repositories.documentNotes,
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

  test('restores prompt-mode zone text after a cancelled generation with live writes', async () => {
    const previousDelay = process.env.LUCENTDOCS_TEST_INLINE_DELAY_MS
    process.env.LUCENTDOCS_TEST_INLINE_DELAY_MS = '50'

    try {
      const project = await adapter.services.projects.create('Story', {
        ownerUserId: 'user_1',
      })
      const document = await adapter.services.documents.createForProject(
        project.id,
        'chapter-prompt-rollback.md'
      )

      if (!document) {
        throw new Error('Expected a project document to be created.')
      }

      const sessionId = 'inline_session_prompt_rollback'
      await yjsRuntime.replaceLiveDocumentContent(document.id, {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Lead ' },
              {
                type: 'ai_zone',
                attrs: {
                  id: 'zone_prompt',
                  streaming: true,
                  sessionId,
                  originalSlice: null,
                },
                content: [{ type: 'text', text: 'original' }],
              },
            ],
          },
        ],
      } as JsonObject)

      const { generationId } = await inlineRuntime.startGeneration({
        mode: 'prompt',
        projectId: project.id,
        documentId: document.id,
        sessionId,
        prompt: 'rewrite this',
        selectionFrom: 0,
        selectionTo: 100,
        requesterClientName: 'test_client',
      })

      await sleep(10)

      await yjsRuntime.applyProsemirrorTransform(document.id, {
        transform: (currentDoc) => {
          const action: InlineZoneWriteAction = {
            type: 'replace_range',
            fromOffset: 0,
            toOffset: Number.MAX_SAFE_INTEGER,
            content: 'partial',
          }
          const applied = applyInlineZoneWriteActionToDoc(currentDoc, sessionId, action)
          return {
            changed: applied.changed,
            nextDoc: applied.nextDoc,
            result: applied,
          }
        },
      })

      inlineRuntime.cancelGeneration(
        { projectId: project.id, documentId: document.id, sessionId },
        generationId
      )

      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (
          !inlineRuntime.isGenerating({ projectId: project.id, documentId: document.id, sessionId })
        ) {
          break
        }
        await sleep(10)
      }

      const live = await yjsRuntime.getDocumentProsemirrorJson(document.id)
      const zoneText = getInlineZoneTextFromDoc(schema.nodeFromJSON(live), sessionId)
      expect(zoneText.zoneFound).toBe(true)
      expect(zoneText.text).toBe('original')
    } finally {
      if (previousDelay === undefined) {
        delete process.env.LUCENTDOCS_TEST_INLINE_DELAY_MS
      } else {
        process.env.LUCENTDOCS_TEST_INLINE_DELAY_MS = previousDelay
      }
    }
  })

  async function runPromptGeneration(
    projectId: string,
    documentId: string,
    sessionId: string,
    prompt: string,
    selectionFrom: number,
    selectionTo: number
  ): Promise<void> {
    await inlineRuntime.startGeneration({
      mode: 'prompt',
      projectId,
      documentId,
      sessionId,
      prompt,
      selectionFrom,
      selectionTo,
      requesterClientName: 'test_client',
    })

    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (!inlineRuntime.isGenerating({ projectId, documentId, sessionId })) {
        break
      }
      await sleep(10)
    }
  }

  async function runContinuationGeneration(
    projectId: string,
    documentId: string,
    sessionId: string
  ): Promise<void> {
    await inlineRuntime.startGeneration({
      mode: 'continue',
      projectId,
      documentId,
      sessionId,
      selectionFrom: 0,
      selectionTo: 0,
      requesterClientName: 'test_client',
    })

    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (
        !inlineRuntime.isGenerating({ projectId, documentId, sessionId })
      ) {
        break
      }
      await sleep(10)
    }
  }

  test('undoSessionTurn restores zone text and pops the assistant message', async () => {
    const project = await adapter.services.projects.create('Story', {
      ownerUserId: 'user_1',
    })
    const document = await adapter.services.documents.createForProject(project.id, 'chapter-undo.md')

    if (!document) {
      throw new Error('Expected a project document to be created.')
    }

    const sessionId = 'inline_session_undo'
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
                id: 'zone_undo',
                streaming: true,
                sessionId,
                originalSlice: null,
              },
            },
          ],
        },
      ],
    } as JsonObject)

    await runContinuationGeneration(project.id, document.id, sessionId)

    const scope = { projectId: project.id, documentId: document.id, sessionId }
    const sessionsBefore = await inlineRuntime.getSessions(scope, [sessionId])
    const sessionBefore = sessionsBefore[sessionId]
    expect(sessionBefore?.turnCheckpoints?.length).toBe(1)
    expect(sessionBefore?.messages.some((message) => message.role === 'assistant')).toBe(true)

    const liveBeforeUndo = await yjsRuntime.getDocumentProsemirrorJson(document.id)
    expect(extractDocText(liveBeforeUndo)).toBe('Once spark')

    const undone = await inlineRuntime.undoSessionTurn(scope, 'test_client')
    expect(undone.messages.some((message) => message.role === 'assistant')).toBe(false)
    expect(undone.turnCheckpoints?.length ?? 0).toBe(0)
    expect(undone.redoTurnCheckpoints?.length).toBe(1)

    const liveAfterUndo = await yjsRuntime.getDocumentProsemirrorJson(document.id)
    expect(extractDocText(liveAfterUndo)).toBe('Once ')
  })

  test('redoSessionTurn restores assistant message and zone text after undo', async () => {
    const project = await adapter.services.projects.create('Story', {
      ownerUserId: 'user_1',
    })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapter-redo.md'
    )

    if (!document) {
      throw new Error('Expected a project document to be created.')
    }

    const sessionId = 'inline_session_redo'
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
                id: 'zone_redo',
                streaming: true,
                sessionId,
                originalSlice: null,
              },
            },
          ],
        },
      ],
    } as JsonObject)

    const scope = { projectId: project.id, documentId: document.id, sessionId }
    await runContinuationGeneration(project.id, document.id, sessionId)
    await inlineRuntime.undoSessionTurn(scope, 'test_client')

    const redone = await inlineRuntime.redoSessionTurn(scope, 'test_client')
    expect(redone.messages.some((message) => message.role === 'assistant')).toBe(true)
    expect(redone.turnCheckpoints?.length).toBe(1)
    expect(redone.redoTurnCheckpoints?.length ?? 0).toBe(0)

    const live = await yjsRuntime.getDocumentProsemirrorJson(document.id)
    expect(extractDocText(live)).toBe('Once spark')
  })

  test('undoSessionTurn on prompt-mode first turn keeps the zone and restores selected text', async () => {
    const project = await adapter.services.projects.create('Story', {
      ownerUserId: 'user_1',
    })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapter-prompt-undo.md'
    )

    if (!document) {
      throw new Error('Expected a project document to be created.')
    }

    const sessionId = 'inline_session_prompt_undo'
    await yjsRuntime.replaceLiveDocumentContent(document.id, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ' },
            {
              type: 'ai_zone',
              attrs: {
                id: 'zone_prompt_undo',
                streaming: true,
                sessionId,
                originalSlice: null,
              },
              content: [{ type: 'text', text: 'world' }],
            },
          ],
        },
      ],
    } as JsonObject)

    const scope = { projectId: project.id, documentId: document.id, sessionId }
    await runPromptGeneration(project.id, document.id, sessionId, 'rewrite this', 0, 100)

    const liveBeforeUndo = await yjsRuntime.getDocumentProsemirrorJson(document.id)
    expect(extractDocText(liveBeforeUndo)).toBe('Hello spark')

    const undone = await inlineRuntime.undoSessionTurn(scope, 'test_client')
    expect(undone.messages.some((message) => message.role === 'user')).toBe(true)
    expect(undone.messages.some((message) => message.role === 'assistant')).toBe(false)

    const liveAfterUndo = await yjsRuntime.getDocumentProsemirrorJson(document.id)
    expect(extractDocText(liveAfterUndo)).toBe('Hello world')

    const content = schema.nodeFromJSON(liveAfterUndo)
    let zoneCount = 0
    content.descendants((node) => {
      if (node.type === schema.nodes.ai_zone) {
        zoneCount += 1
      }
      return true
    })
    expect(zoneCount).toBe(1)
  })

  test('undoSessionTurn on a single assistant turn removes the zone from the document', async () => {
    const project = await adapter.services.projects.create('Story', {
      ownerUserId: 'user_1',
    })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapter-remove-zone.md'
    )

    if (!document) {
      throw new Error('Expected a project document to be created.')
    }

    const sessionId = 'inline_session_remove'
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
                id: 'zone_remove',
                streaming: true,
                sessionId,
                originalSlice: null,
              },
            },
          ],
        },
      ],
    } as JsonObject)

    const scope = { projectId: project.id, documentId: document.id, sessionId }
    await runContinuationGeneration(project.id, document.id, sessionId)
    await inlineRuntime.undoSessionTurn(scope, 'test_client')

    const live = await yjsRuntime.getDocumentProsemirrorJson(document.id)
    const content = schema.nodeFromJSON(live)
    let zoneCount = 0
    content.descendants((node) => {
      if (node.type === schema.nodes.ai_zone) {
        zoneCount += 1
      }
      return true
    })
    expect(zoneCount).toBe(0)
    expect(extractDocText(live)).toBe('Once ')
  })

  test('restoreAcceptedSessionZone re-wraps accepted text without mutating session history', async () => {
    const project = await adapter.services.projects.create('Story', {
      ownerUserId: 'user_1',
    })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapter-restore.md'
    )

    if (!document) {
      throw new Error('Expected a project document to be created.')
    }

    const sessionId = 'inline_session_restore'
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
                id: 'zone_restore',
                streaming: true,
                sessionId,
                originalSlice: null,
              },
            },
          ],
        },
      ],
    } as JsonObject)

    const scope = { projectId: project.id, documentId: document.id, sessionId }
    await runContinuationGeneration(project.id, document.id, sessionId)

    const generated = await yjsRuntime.getDocumentProsemirrorJson(document.id)
    expect(extractDocText(generated)).toBe('Once spark')

    await yjsRuntime.replaceLiveDocumentContent(document.id, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Once spark' }],
        },
      ],
    } as JsonObject)

    const sessionBeforeRestore = await inlineRuntime.getSessions(scope, [sessionId])
    const restored = await inlineRuntime.restoreAcceptedSessionZone(scope, 'test_client')

    expect(restored.turnCheckpoints?.length).toBe(sessionBeforeRestore[sessionId]?.turnCheckpoints?.length)
    expect(restored.messages.length).toBe(sessionBeforeRestore[sessionId]?.messages.length)

    const live = await yjsRuntime.getDocumentProsemirrorJson(document.id)
    expect(extractDocText(live)).toBe('Once spark')
    let restoredZoneCount = 0
    schema.nodeFromJSON(live).descendants((node) => {
      if (node.type === schema.nodes.ai_zone) restoredZoneCount += 1
      return true
    })
    expect(restoredZoneCount).toBe(1)
  })

  test('continuation generation persists assistant message and turn checkpoint', async () => {
    const project = await adapter.services.projects.create('Story', {
      ownerUserId: 'user_1',
    })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapter-continue-checkpoint.md'
    )

    if (!document) {
      throw new Error('Expected a project document to be created.')
    }

    const sessionId = 'inline_session_continue_checkpoint'
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
                id: 'zone_continue_checkpoint',
                streaming: true,
                sessionId,
                originalSlice: null,
              },
            },
          ],
        },
      ],
    } as JsonObject)

    const scope = { projectId: project.id, documentId: document.id, sessionId }
    await runContinuationGeneration(project.id, document.id, sessionId)

    const sessions = await inlineRuntime.getSessions(scope, [sessionId])
    const session = sessions[sessionId]
    expect(session?.messages.some((message) => message.role === 'assistant')).toBe(true)
    expect(session?.turnCheckpoints?.length).toBe(1)
  })

  test('pruneOrphans keeps continuation session after zone is removed from the document', async () => {
    const project = await adapter.services.projects.create('Story', {
      ownerUserId: 'user_1',
    })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapter-reject-prune.md'
    )

    if (!document) {
      throw new Error('Expected a project document to be created.')
    }

    const sessionId = 'inline_session_reject_prune'
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
                id: 'zone_reject_prune',
                streaming: true,
                sessionId,
                originalSlice: null,
              },
            },
          ],
        },
      ],
    } as JsonObject)

    const scope = { projectId: project.id, documentId: document.id, sessionId }
    await runContinuationGeneration(project.id, document.id, sessionId)

    await yjsRuntime.replaceLiveDocumentContent(document.id, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Once ' }],
        },
      ],
    } as JsonObject)

    await inlineRuntime.pruneOrphanSessions({
      projectId: project.id,
      documentId: document.id,
    })

    const sessions = await inlineRuntime.getSessions(scope, [sessionId])
    expect(sessions[sessionId]).toBeDefined()
    expect(sessions[sessionId]?.turnCheckpoints?.length).toBe(1)
  })

  test('undoSessionTurn works after reject-like zone removal and prune when zone is restored', async () => {
    const project = await adapter.services.projects.create('Story', {
      ownerUserId: 'user_1',
    })
    const document = await adapter.services.documents.createForProject(
      project.id,
      'chapter-reject-undo-chain.md'
    )

    if (!document) {
      throw new Error('Expected a project document to be created.')
    }

    const sessionId = 'inline_session_reject_undo_chain'
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
                id: 'zone_reject_undo_chain',
                streaming: true,
                sessionId,
                originalSlice: null,
              },
            },
          ],
        },
      ],
    } as JsonObject)

    const scope = { projectId: project.id, documentId: document.id, sessionId }
    await runContinuationGeneration(project.id, document.id, sessionId)

    await yjsRuntime.replaceLiveDocumentContent(document.id, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Once ' }],
        },
      ],
    } as JsonObject)

    await inlineRuntime.pruneOrphanSessions({
      projectId: project.id,
      documentId: document.id,
    })

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
                id: 'zone_reject_undo_chain',
                streaming: false,
                sessionId,
                originalSlice: null,
              },
              content: [{ type: 'text', text: 'spark' }],
            },
          ],
        },
      ],
    } as JsonObject)

    const undone = await inlineRuntime.undoSessionTurn(scope, 'test_client')
    expect(undone.messages.some((message) => message.role === 'assistant')).toBe(false)

    const live = await yjsRuntime.getDocumentProsemirrorJson(document.id)
    expect(extractDocText(live)).toBe('Once ')
    let zoneCount = 0
    schema.nodeFromJSON(live).descendants((node) => {
      if (node.type === schema.nodes.ai_zone) zoneCount += 1
      return true
    })
    expect(zoneCount).toBe(0)
  })
})
