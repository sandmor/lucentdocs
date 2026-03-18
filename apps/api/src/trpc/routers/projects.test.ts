import { describe, expect, test } from 'bun:test'
import { LOCAL_DEFAULT_USER, type User } from '../../core/models/user.js'
import type { AppContext } from '../index.js'
import { projectsRouter } from './projects.js'
import { createTestAdapter, type TestAdapter } from '../../testing/factory.js'
import { projectSyncBus } from '../project-sync.js'

function createCallerContext(options?: {
  user?: User
  identityUsers?: User[]
  adapter?: TestAdapter
}): AppContext {
  const adapter = options?.adapter ?? createTestAdapter()
  const currentUser = options?.user ?? LOCAL_DEFAULT_USER
  const identityUsers = options?.identityUsers ?? [currentUser]
  const identityUsersById = new Map(identityUsers.map((user) => [user.id, user]))
  const identityUsersByEmail = new Map(
    identityUsers.map((user) => [user.email?.toLowerCase() ?? '', user])
  )

  return {
    user: currentUser,
    services: adapter.services,
    authPort: {
      isEnabled: () => false,
      getUserById: async (userId: string) => identityUsersById.get(userId) ?? null,
      getUserByEmail: async (email: string) =>
        identityUsersByEmail.get(email.toLowerCase()) ?? null,
      validateSession: async () => currentUser,
      login: async () => ({ success: false, error: 'not implemented' }),
      logout: async () => ({ success: true }),
      signup: async () => ({ success: false, error: 'not implemented' }),
    },
    yjsRuntime: {
      evictLiveDocument: () => {},
    } as unknown as AppContext['yjsRuntime'],
    chatRuntime: {} as AppContext['chatRuntime'],
    inlineRuntime: {} as AppContext['inlineRuntime'],
    documentImportRuntime: {
      enqueueImport: async () => ({ jobId: 'test-job', queued: 0, queuedJobs: 0 }),
    },
  }
}

describe('projectsRouter', () => {
  test('delete removes embeddings for project-owned documents', async () => {
    const user: User = {
      id: 'owner_1',
      name: 'Owner One',
      email: 'owner1@example.com',
      role: 'user',
    }
    const adapter = createTestAdapter()
    const caller = projectsRouter.createCaller(
      createCallerContext({
        user,
        identityUsers: [user],
        adapter,
      })
    )

    const project = await caller.create({ title: 'Story' })
    const doc = await adapter.services.documents.createForProject(project.id, 'chapter-1.md')
    if (!doc) {
      throw new Error('Expected test document to be created.')
    }

    const now = Date.now()
    await adapter.repositories.documentEmbeddings.replaceEmbeddings({
      documentId: doc.id,
      providerConfigId: null,
      providerId: 'openrouter',
      type: 'openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      model: 'openai/text-embedding-3-small',
      strategy: { type: 'whole_document', properties: {} },
      documentTimestamp: now,
      contentHash: 'project-delete-embedding-hash',
      chunks: [
        {
          ordinal: 0,
          start: 0,
          end: 32,
          text: 'Moonlight crosses the empty quay.',
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

    await caller.delete({ id: project.id })

    const remaining = await adapter.repositories.documentEmbeddings.findEmbeddings(
      doc.id,
      'https://openrouter.ai/api/v1',
      'openai/text-embedding-3-small'
    )
    expect(remaining).toHaveLength(0)
  })

  test('reassignOwner updates the explicit project owner through the identity boundary', async () => {
    const adminUser: User = {
      id: 'admin_user',
      name: 'Admin',
      email: 'admin@example.com',
      role: 'admin',
    }
    const nextOwner: User = {
      id: 'owner_2',
      name: 'Owner Two',
      email: 'owner2@example.com',
      role: 'user',
    }
    const adapter = createTestAdapter()
    const ctx = createCallerContext({
      user: adminUser,
      identityUsers: [adminUser, nextOwner],
      adapter,
    })
    const caller = projectsRouter.createCaller(ctx)
    const events: Array<Parameters<Parameters<typeof projectSyncBus.subscribe>[0]>[0]> = []
    const unsubscribe = projectSyncBus.subscribe((event) => {
      events.push(event)
    })

    try {
      const created = await caller.create({ title: 'Story' })
      expect(created.ownerUserId).toBe(adminUser.id)

      const updated = await caller.reassignOwner({
        id: created.id,
        ownerEmail: nextOwner.email!,
      })

      expect(updated.ownerUserId).toBe(nextOwner.id)

      const stored = await projectsRouter
        .createCaller(
          createCallerContext({
            user: nextOwner,
            identityUsers: [adminUser, nextOwner],
            adapter,
          })
        )
        .get({ id: created.id })
      expect(stored.ownerUserId).toBe(nextOwner.id)

      const latestEvent = events.at(-1)
      expect(latestEvent?.type).toBe('project.updated')
      if (latestEvent?.type === 'project.updated') {
        expect(latestEvent.audienceUserIds.sort()).toEqual([adminUser.id, nextOwner.id].sort())
      }
    } finally {
      unsubscribe()
    }
  })

  test('admin can read projects they do not own', async () => {
    const adminUser: User = {
      id: 'admin_user',
      name: 'Admin',
      email: 'admin@example.com',
      role: 'admin',
    }
    const ownerUser: User = {
      id: 'owner_1',
      name: 'Owner One',
      email: 'owner1@example.com',
      role: 'user',
    }
    const adapter = createTestAdapter()

    const ownerCaller = projectsRouter.createCaller(
      createCallerContext({
        user: ownerUser,
        identityUsers: [adminUser, ownerUser],
        adapter,
      })
    )

    const project = await ownerCaller.create({ title: 'Story' })

    const adminCaller = projectsRouter.createCaller(
      createCallerContext({
        user: adminUser,
        identityUsers: [adminUser, ownerUser],
        adapter,
      })
    )

    await expect(adminCaller.get({ id: project.id })).resolves.toMatchObject({ id: project.id })
  })
})
