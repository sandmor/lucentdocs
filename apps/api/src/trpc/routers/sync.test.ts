import { describe, expect, test } from 'bun:test'
import { projectSyncEventSchema } from './sync.js'

describe('syncRouter schemas', () => {
  test('accepts documents.import-many reason', () => {
    const parsed = projectSyncEventSchema.parse({
      id: 'e1',
      projectId: 'p1',
      createdAt: Date.now(),
      type: 'documents.changed',
      changedDocumentIds: ['d1'],
      deletedDocumentIds: [],
      defaultDocumentId: null,
      reason: 'documents.import-many',
    })

    expect(parsed.type).toBe('documents.changed')
    if (parsed.type === 'documents.changed') {
      expect(parsed.reason).toBe('documents.import-many')
    }
  })
})
