import { describe, expect, test } from 'bun:test'
import { createProject, deleteProject, hasProject, updateProject } from './projects.js'
import {
  createDocument,
  createDocumentForProject,
  getDocument,
  listDocumentsForProject,
} from './documents.js'
import * as dalProjectDocs from '../dal/projectDocuments.js'

describe('projects repository', () => {
  test('creates projects without attaching a default document', async () => {
    const project = await createProject('project-empty')
    const docs = await listDocumentsForProject(project.id)

    expect(project.title).toBe('project-empty')
    expect(docs).toHaveLength(0)
  })

  test('updates project metadata and title without mutating project documents', async () => {
    const project = await createProject('project-metadata')
    const doc = await createDocumentForProject(project.id, 'stories/chapter-1.md')

    expect(doc).not.toBeNull()

    const withMetadata = await updateProject(project.id, { metadata: { theme: 'mystery' } })
    const renamed = await updateProject(project.id, { title: 'renamed-project' })

    expect(withMetadata).not.toBeNull()
    expect(withMetadata!.metadata).toEqual({ theme: 'mystery' })
    expect(renamed).not.toBeNull()
    expect(renamed!.title).toBe('renamed-project')

    const persistedDoc = await getDocument(doc!.id)
    expect(persistedDoc).not.toBeNull()
    expect(persistedDoc!.title).toBe('stories/chapter-1.md')
  })

  test('deleting a project deletes only documents solely associated with it', async () => {
    const projectA = await createProject('project-delete-a')
    const projectB = await createProject('project-delete-b')

    const exclusive = await createDocumentForProject(projectA.id, 'stories/exclusive.md')
    const shared = await createDocument('stories/shared.md')
    const now = Date.now()

    await dalProjectDocs.insert({ projectId: projectA.id, documentId: shared.id, addedAt: now })
    await dalProjectDocs.insert({ projectId: projectB.id, documentId: shared.id, addedAt: now + 1 })

    const deleted = await deleteProject(projectA.id)
    expect(deleted).toBe(true)
    expect(await hasProject(projectA.id)).toBe(false)
    expect(await hasProject(projectB.id)).toBe(true)

    expect(await getDocument(exclusive!.id)).toBeNull()
    expect(await getDocument(shared.id)).not.toBeNull()
  })
})
