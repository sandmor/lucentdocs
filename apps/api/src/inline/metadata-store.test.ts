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
        listDocumentIds: async () => ['d1'],
        findSoleDocumentIdsByProjectId: async () => ['d1'],
        findProjectIdsByDocumentId: async () => ['p1'],
        findSoleProjectIdByDocumentId: async () => 'p1',
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
        listDocumentIds: async () => ['d1'],
        findSoleDocumentIdsByProjectId: async () => ['d1'],
        findProjectIdsByDocumentId: async () => ['p1'],
        findSoleProjectIdByDocumentId: async () => 'p1',
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
})
