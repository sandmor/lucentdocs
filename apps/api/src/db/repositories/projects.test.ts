import { describe, expect, test } from 'bun:test'
import { createProject, updateProject } from './projects.js'

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
})
