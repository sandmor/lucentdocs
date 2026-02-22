import { describe, expect, test } from 'bun:test'
import {
  createDocument,
  createVersionSnapshot,
  getVersionHistory,
  updateDocument,
} from './documents.js'

describe('documents repository', () => {
  test('returns null metadata when metadata is explicitly cleared', async () => {
    const doc = await createDocument('metadata-clear')

    await updateDocument(doc.id, { metadata: { stage: 'draft' } })
    const updated = await updateDocument(doc.id, { metadata: null })

    expect(updated).not.toBeNull()
    expect(updated!.metadata).toBeNull()
  })

  test('persists multiple snapshots created concurrently', async () => {
    const doc = await createDocument('concurrent-snapshot')
    await Promise.all([createVersionSnapshot(doc.id), createVersionSnapshot(doc.id)])
    const history = await getVersionHistory(doc.id)

    expect(history.length).toBeGreaterThanOrEqual(2)
    expect(history.every((snapshot) => snapshot.documentId === doc.id)).toBe(true)
  })
})
