import { describe, expect, test } from 'bun:test'
import {
  createProject,
  createProjectSnapshot,
  getProjectVersions,
  restoreProject,
  updateProject,
} from './projects.js'
import { replaceDocument } from '../../yjs/server.js'

const makeDoc = (text: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text }],
    },
  ],
})

describe('projects repository', () => {
  test('returns updated metadata consistently when setting and clearing', async () => {
    const project = await createProject('project-metadata')

    const withMetadata = await updateProject(project.id, { metadata: { theme: 'mystery' } })
    const cleared = await updateProject(project.id, { metadata: null })

    expect(withMetadata).not.toBeNull()
    expect(withMetadata!.metadata).toEqual({ theme: 'mystery' })
    expect(cleared).not.toBeNull()
    expect(cleared!.metadata).toBeNull()
  })

  test('restore rolls back content and prunes newer project snapshots', async () => {
    const project = await createProject('project-restore')

    await replaceDocument(project.documentId, makeDoc('v1'))
    const snapshot1 = await createProjectSnapshot(project.id)
    expect(snapshot1).not.toBeNull()

    await replaceDocument(project.documentId, makeDoc('v2'))
    const snapshot2 = await createProjectSnapshot(project.id)
    expect(snapshot2).not.toBeNull()

    const restored = await restoreProject(project.id, snapshot1!.id)
    expect(restored).not.toBeNull()
    expect(restored!.content).toContain('v1')
    expect(restored!.content).not.toContain('v2')

    const versions = await getProjectVersions(project.id)
    const versionIds = new Set(versions.map((version) => version.id))
    expect(versionIds.has(snapshot1!.id)).toBe(true)
    expect(versionIds.has(snapshot2!.id)).toBe(false)
  })
})
