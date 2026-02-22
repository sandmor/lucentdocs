import { describe, expect, test } from 'bun:test'
import {
  createDirectoryForProject,
  createDocumentForProject,
  createDocument,
  deleteDirectoryForProject,
  getDocumentForProject,
  listDocumentsForProject,
  moveDirectoryForProject,
  moveDocumentForProject,
  openOrCreateDefaultDocumentForProject,
  setDefaultDocumentForProject,
  createVersionSnapshot,
  getVersionHistory,
  updateDocument,
  updateDocumentForProject,
} from './documents.js'
import { createProject } from './projects.js'
import * as dalProjectDocs from '../dal/projectDocuments.js'
import { directoryPathFromSentinel, isDirectorySentinelPath } from '@plotline/shared'

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

  test('project-scoped list hides shared documents', async () => {
    const projectA = await createProject('shared-filter-a')
    const projectB = await createProject('shared-filter-b')

    const solo = await createDocumentForProject(projectA.id, 'stories/solo.md')
    const shared = await createDocument('stories/shared.md')
    const now = Date.now()

    await dalProjectDocs.insert({ projectId: projectA.id, documentId: shared.id, addedAt: now })
    await dalProjectDocs.insert({ projectId: projectB.id, documentId: shared.id, addedAt: now + 1 })

    const docs = await listDocumentsForProject(projectA.id)
    const ids = new Set(docs.map((doc) => doc.id))

    expect(solo).not.toBeNull()
    expect(ids.has(solo!.id)).toBe(true)
    expect(ids.has(shared.id)).toBe(false)
  })

  test('project-scoped get ignores shared documents', async () => {
    const projectA = await createProject('shared-get-a')
    const projectB = await createProject('shared-get-b')
    const shared = await createDocument('stories/shared-two.md')
    const now = Date.now()

    await dalProjectDocs.insert({ projectId: projectA.id, documentId: shared.id, addedAt: now })
    await dalProjectDocs.insert({ projectId: projectB.id, documentId: shared.id, addedAt: now + 1 })

    const doc = await getDocumentForProject(projectA.id, shared.id)
    expect(doc).toBeNull()
  })

  test('directory creation uses sentinel docs that stay hidden from open-document APIs', async () => {
    const project = await createProject('directory-create')
    const created = await createDirectoryForProject(project.id, 'stories/chapter-1')
    expect(created).not.toBeNull()
    expect(created!.title).toContain('/__dir__')

    const listed = await listDocumentsForProject(project.id)
    const sentinel = listed.find((doc) => doc.id === created!.id)
    expect(sentinel).toBeDefined()
    expect(isDirectorySentinelPath(sentinel!.title)).toBe(true)
    expect(directoryPathFromSentinel(sentinel!.title)).toBe('stories/chapter-1')

    const openable = await getDocumentForProject(project.id, created!.id)
    expect(openable).toBeNull()
  })

  test('deleting a directory removes all nested documents and sentinels', async () => {
    const project = await createProject('directory-delete')
    const folder = await createDirectoryForProject(project.id, 'world/arc-one')
    const nested = await createDocumentForProject(project.id, 'world/arc-one/scene-1.md')
    const nestedChild = await createDocumentForProject(project.id, 'world/arc-one/notes/outline.md')
    const outside = await createDocumentForProject(project.id, 'world/arc-two/scene-a.md')

    expect(folder).not.toBeNull()
    expect(nested).not.toBeNull()
    expect(nestedChild).not.toBeNull()
    expect(outside).not.toBeNull()

    const deleted = await deleteDirectoryForProject(project.id, 'world/arc-one')
    expect(deleted).not.toBeNull()

    const after = await listDocumentsForProject(project.id)
    const remainingIds = new Set(after.map((doc) => doc.id))
    expect(remainingIds.has(folder!.id)).toBe(false)
    expect(remainingIds.has(nested!.id)).toBe(false)
    expect(remainingIds.has(nestedChild!.id)).toBe(false)
    expect(remainingIds.has(outside!.id)).toBe(true)
  })

  test('moving a document updates its full path', async () => {
    const project = await createProject('move-file')
    const file = await createDocumentForProject(project.id, 'drafts/chapter-1.md')
    expect(file).not.toBeNull()

    const moved = await moveDocumentForProject(project.id, file!.id, 'archive/chapter-1.md')
    expect(moved).not.toBeNull()
    expect(moved!.title).toBe('archive/chapter-1.md')
  })

  test('moving a directory remaps nested files and sentinels', async () => {
    const project = await createProject('move-directory')
    await createDirectoryForProject(project.id, 'drafts/chapter-1')
    const file = await createDocumentForProject(project.id, 'drafts/chapter-1/scene-a.md')
    const nested = await createDocumentForProject(project.id, 'drafts/chapter-1/notes/outline.md')
    expect(file).not.toBeNull()
    expect(nested).not.toBeNull()

    const moved = await moveDirectoryForProject(project.id, 'drafts/chapter-1', 'book/chapter-1')
    expect(moved).not.toBeNull()
    expect(moved!.movedDocumentIds.length).toBeGreaterThanOrEqual(3)

    const docs = await listDocumentsForProject(project.id)
    const titleById = new Map(docs.map((doc) => [doc.id, doc.title]))
    expect(titleById.get(file!.id)).toBe('book/chapter-1/scene-a.md')
    expect(titleById.get(nested!.id)).toBe('book/chapter-1/notes/outline.md')
    expect(
      docs.some(
        (doc) =>
          isDirectorySentinelPath(doc.title) &&
          directoryPathFromSentinel(doc.title) === 'book/chapter-1'
      )
    ).toBe(true)
  })

  test('opening a project falls back to a visible document when default is missing', async () => {
    const project = await createProject('open-latest')
    const older = await createDocumentForProject(project.id, 'drafts/older.md')
    const newer = await createDocumentForProject(project.id, 'drafts/newer.md')
    expect(older).not.toBeNull()
    expect(newer).not.toBeNull()

    await updateDocumentForProject(project.id, older!.id, { metadata: { rev: 2 } })

    const opened = await openOrCreateDefaultDocumentForProject(project.id)
    expect(opened).not.toBeNull()
    expect(opened!.id).toBe(newer!.id)
  })

  test('opening a project honors metadata default_document when present', async () => {
    const project = await createProject('open-default-from-metadata')
    const first = await createDocumentForProject(project.id, 'book/chapter-1.md')
    const second = await createDocumentForProject(project.id, 'book/chapter-2.md')
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()

    const setDefault = await setDefaultDocumentForProject(project.id, first!.id)
    expect(setDefault).toBe(true)

    const opened = await openOrCreateDefaultDocumentForProject(project.id)
    expect(opened).not.toBeNull()
    expect(opened!.id).toBe(first!.id)
  })

  test('opening an empty project creates a default document', async () => {
    const project = await createProject('open-empty')
    await createDirectoryForProject(project.id, 'only/folder')

    const opened = await openOrCreateDefaultDocumentForProject(project.id)
    expect(opened).not.toBeNull()
    expect(opened!.title).toBe('untitled.md')

    const docs = await listDocumentsForProject(project.id)
    expect(docs.some((doc) => doc.id === opened!.id)).toBe(true)
  })
})
