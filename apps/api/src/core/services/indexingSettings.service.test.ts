import { describe, expect, test } from 'bun:test'
import { createTestAdapter } from '../../testing/factory.js'

describe('IndexingSettingsService', () => {
  test('resolves document indexing settings from document to project to user to global', async () => {
    const adapter = createTestAdapter()

    const project = await adapter.services.projects.create('Story', {
      ownerUserId: 'user_1',
    })
    const document = await adapter.services.documents.createForProject(project.id, 'chapter-01.md')

    if (!document) {
      throw new Error('Expected a project document to be created.')
    }

    const globalSnapshot = await adapter.services.indexingSettings.getGlobal()
    expect(globalSnapshot.strategy.type).toBe('sliding_window')

    await adapter.services.indexingSettings.updateUserStrategy('user_1', {
      type: 'whole_document',
      properties: {},
    })

    const userResolved = await adapter.services.indexingSettings.resolveForDocument(document.id)
    expect(userResolved?.scopeType).toBe('user')
    expect(userResolved?.strategy.type).toBe('whole_document')

    await adapter.services.indexingSettings.updateProjectStrategy(project.id, {
      type: 'sliding_window',
      properties: {
        level: 'character',
        windowSize: 300,
        stride: 150,
      },
    })

    const projectResolved = await adapter.services.indexingSettings.resolveForDocument(document.id)
    expect(projectResolved?.scopeType).toBe('project')
    expect(projectResolved?.strategy.type).toBe('sliding_window')
    expect(projectResolved?.strategy.properties.level).toBe('character')
    if (projectResolved?.strategy.type === 'sliding_window') {
      expect(projectResolved.strategy.properties.level).toBe('character')
      if (projectResolved.strategy.properties.level === 'character') {
        expect(projectResolved.strategy.properties.windowSize).toBe(300)
      }
    }

    await adapter.services.indexingSettings.updateDocumentStrategy(document.id, {
      type: 'whole_document',
      properties: {},
    })

    const documentResolved = await adapter.services.indexingSettings.resolveForDocument(document.id)
    expect(documentResolved?.scopeType).toBe('document')
    expect(documentResolved?.strategy.type).toBe('whole_document')
  })

  test('ignores project and user settings for multi-project documents', async () => {
    const adapter = createTestAdapter()

    const primaryProject = await adapter.services.projects.create('Story', {
      ownerUserId: 'user_1',
    })
    const secondaryProject = await adapter.services.projects.create('Shared board', {
      ownerUserId: 'user_2',
    })
    const document = await adapter.services.documents.createForProject(
      primaryProject.id,
      'shared.md'
    )

    if (!document) {
      throw new Error('Expected a project document to be created.')
    }

    await adapter.repositories.projectDocuments.insert({
      projectId: secondaryProject.id,
      documentId: document.id,
      addedAt: Date.now(),
    })

    await adapter.services.indexingSettings.updateUserStrategy('user_1', {
      type: 'whole_document',
      properties: {},
    })
    await adapter.services.indexingSettings.updateProjectStrategy(primaryProject.id, {
      type: 'whole_document',
      properties: {},
    })

    const resolved = await adapter.services.indexingSettings.resolveForDocument(document.id)
    expect(resolved?.scopeType).toBe('global')
    expect(resolved?.strategy.type).toBe('sliding_window')
  })
})
