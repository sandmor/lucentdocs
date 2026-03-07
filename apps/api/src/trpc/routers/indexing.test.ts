import { describe, expect, test } from 'bun:test'
import { LOCAL_DEFAULT_USER, type User } from '../../core/models/user.js'
import type { AppContext } from '../index.js'
import { indexingRouter } from './indexing.js'
import { createTestAdapter, type TestAdapter } from '../../testing/factory.js'

function createCallerContext(options?: { user?: User; adapter?: TestAdapter }): AppContext {
  const adapter = options?.adapter ?? createTestAdapter()
  const currentUser = options?.user ?? LOCAL_DEFAULT_USER

  return {
    user: currentUser,
    services: adapter.services,
    authPort: {
      isEnabled: () => false,
      getUserById: async (userId: string) => (userId === currentUser.id ? currentUser : null),
      getUserByEmail: async (email: string) =>
        currentUser.email?.toLowerCase() === email.toLowerCase() ? currentUser : null,
      validateSession: async () => currentUser,
      login: async () => ({ success: false, error: 'not implemented' }),
      logout: async () => ({ success: true }),
      signup: async () => ({ success: false, error: 'not implemented' }),
    },
    yjsRuntime: {} as AppContext['yjsRuntime'],
    embeddingRuntime: {} as AppContext['embeddingRuntime'],
    chatRuntime: {} as AppContext['chatRuntime'],
    inlineRuntime: {} as AppContext['inlineRuntime'],
  }
}

describe('indexingRouter', () => {
  test('allows document indexing settings for multi-project documents within the owning project', async () => {
    const owner: User = {
      id: 'owner_1',
      name: 'Owner One',
      email: 'owner1@example.com',
      role: 'user',
    }
    const adapter = createTestAdapter()

    const projectA = await adapter.services.projects.create('Story', {
      ownerUserId: owner.id,
    })
    const projectB = await adapter.services.projects.create('Shared', {
      ownerUserId: 'owner_2',
    })
    const document = await adapter.services.documents.createForProject(projectA.id, 'shared.md')

    if (!document) {
      throw new Error('Expected a project document to be created.')
    }

    await adapter.repositories.projectDocuments.insert({
      projectId: projectB.id,
      documentId: document.id,
      addedAt: Date.now(),
    })

    const caller = indexingRouter.createCaller(
      createCallerContext({
        user: owner,
        adapter,
      })
    )

    const updated = await caller.updateDocument({
      projectId: projectA.id,
      id: document.id,
      strategy: {
        type: 'whole_document',
        properties: {},
      },
    })

    expect(updated.document?.strategy).toEqual({
      type: 'whole_document',
      properties: {},
    })
  })

  test('global indexing updates enqueue multi-project documents', async () => {
    const admin: User = {
      id: 'admin_user',
      name: 'Admin',
      email: 'admin@example.com',
      role: 'admin',
    }
    const adapter = createTestAdapter()

    const projectA = await adapter.services.projects.create('Story', {
      ownerUserId: 'owner_1',
    })
    const projectB = await adapter.services.projects.create('Shared', {
      ownerUserId: 'owner_2',
    })
    const document = await adapter.services.documents.createForProject(projectA.id, 'shared.md')

    if (!document) {
      throw new Error('Expected a project document to be created.')
    }

    await adapter.repositories.projectDocuments.insert({
      projectId: projectB.id,
      documentId: document.id,
      addedAt: Date.now(),
    })

    await adapter.repositories.documentEmbeddings.clearQueuedDocuments([document.id])

    const caller = indexingRouter.createCaller(
      createCallerContext({
        user: admin,
        adapter,
      })
    )

    await caller.updateGlobal({
      strategy: {
        type: 'whole_document',
        properties: {},
      },
    })

    const queued = await adapter.repositories.documentEmbeddings.getQueuedDocument(document.id)
    expect(queued).toBeDefined()
  })
})
