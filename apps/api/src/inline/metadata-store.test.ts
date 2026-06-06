import { describe, expect, test } from 'bun:test'
import type { Document, JsonObject } from '@lucentdocs/shared'
import { InlineSessionMetadataStore } from './metadata-store.js'

function createDocument(metadata: JsonObject | null): Document {
  return {
    id: 'd1',
    title: 'Doc',
    type: 'text/markdown',
    metadata,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('InlineSessionMetadataStore.pruneOrphans', () => {
  test('returns early without reading Yjs when there are no inline sessions', async () => {
    const document = createDocument(null)
    let getLatestCalls = 0

    const store = new InlineSessionMetadataStore({
      documents: {
        findById: async () => document,
        findByIds: async () => [document],
        insert: async () => {},
        update: async (_id, data) => {
          document.metadata = data.metadata ?? null
          document.updatedAt = data.updatedAt
        },
        deleteById: async () => {},
      },
      projectDocuments: {
        insert: async () => {},
        hasProjectDocument: async () => true,
        findAssociatedDocumentIds: async () => new Set(['d1']),
        listDocumentIds: async () => ['d1'],
        findSoleDocumentIdsByProjectId: async () => ['d1'],
        findProjectIdsByDocumentId: async () => ['p1'],
        findSoleProjectIdByDocumentId: async () => 'p1',
        findSoleProjectIdsByDocumentIds: async () => new Map([['d1', 'p1']]),
      },
      yjsDocuments: {
        getPersisted: async () => null,
        getLatest: async () => {
          getLatestCalls += 1
          return null
        },
        set: async () => {},
        delete: async () => {},
      },
    })

    const result = await store.pruneOrphans({
      projectId: 'p1',
      documentId: 'd1',
    })

    expect(result).toEqual({
      sessions: {},
      removedSessionIds: [],
    })
    expect(getLatestCalls).toBe(0)
  })

  test('reads Yjs and prunes stored sessions when metadata has inline sessions', async () => {
    const document = createDocument({
      inline_ai_sessions: {
        s1: {
          messages: [],
          choices: [],
          contextBefore: null,
          contextAfter: null,
        },
      },
    })
    let getLatestCalls = 0

    const store = new InlineSessionMetadataStore({
      documents: {
        findById: async () => document,
        findByIds: async () => [document],
        insert: async () => {},
        update: async (_id, data) => {
          document.metadata = data.metadata ?? null
          document.updatedAt = data.updatedAt
        },
        deleteById: async () => {},
      },
      projectDocuments: {
        insert: async () => {},
        hasProjectDocument: async () => true,
        findAssociatedDocumentIds: async () => new Set(['d1']),
        listDocumentIds: async () => ['d1'],
        findSoleDocumentIdsByProjectId: async () => ['d1'],
        findProjectIdsByDocumentId: async () => ['p1'],
        findSoleProjectIdByDocumentId: async () => 'p1',
        findSoleProjectIdsByDocumentIds: async () => new Map([['d1', 'p1']]),
      },
      yjsDocuments: {
        getPersisted: async () => null,
        getLatest: async () => {
          getLatestCalls += 1
          return null
        },
        set: async () => {},
        delete: async () => {},
      },
    })

    const result = await store.pruneOrphans({
      projectId: 'p1',
      documentId: 'd1',
    })

    expect(getLatestCalls).toBe(1)
    expect(result).toEqual({
      sessions: {},
      removedSessionIds: ['s1'],
    })
  })

  test('keeps unreferenced sessions that still have conversation history', async () => {
    const acceptedSession = {
      messages: [
        {
          id: 'msg_user',
          role: 'user',
          text: 'rewrite this',
          tools: [],
        },
        {
          id: 'msg_assistant',
          role: 'assistant',
          text: 'spark',
          tools: [],
        },
      ],
      choices: [],
      contextBefore: 'Hello ',
      contextAfter: null,
      turnCheckpoints: [
        {
          assistantMessageId: 'msg_assistant',
          zoneTextBefore: 'world',
          zoneTextAfter: 'spark',
          assistantMessage: {
            id: 'msg_assistant',
            role: 'assistant',
            text: 'spark',
            tools: [],
          },
        },
      ],
    }

    const document = createDocument({
      inline_ai_sessions: {
        s_accepted: acceptedSession,
      },
    })
    let getLatestCalls = 0

    const store = new InlineSessionMetadataStore({
      documents: {
        findById: async () => document,
        findByIds: async () => [document],
        insert: async () => {},
        update: async (_id, data) => {
          document.metadata = data.metadata ?? null
          document.updatedAt = data.updatedAt
        },
        deleteById: async () => {},
      },
      projectDocuments: {
        insert: async () => {},
        hasProjectDocument: async () => true,
        findAssociatedDocumentIds: async () => new Set(['d1']),
        listDocumentIds: async () => ['d1'],
        findSoleDocumentIdsByProjectId: async () => ['d1'],
        findProjectIdsByDocumentId: async () => ['p1'],
        findSoleProjectIdByDocumentId: async () => 'p1',
        findSoleProjectIdsByDocumentIds: async () => new Map([['d1', 'p1']]),
      },
      yjsDocuments: {
        getPersisted: async () => null,
        getLatest: async () => {
          getLatestCalls += 1
          return null
        },
        set: async () => {},
        delete: async () => {},
      },
    })

    const result = await store.pruneOrphans({
      projectId: 'p1',
      documentId: 'd1',
    })

    expect(getLatestCalls).toBe(1)
    expect(result?.removedSessionIds).toEqual([])
    expect(result?.sessions.s_accepted?.messages.length).toBe(2)
    expect(result?.sessions.s_accepted?.turnCheckpoints?.length).toBe(1)
  })
})
