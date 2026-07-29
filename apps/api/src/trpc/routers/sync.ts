import { z } from 'zod/v4'
import { isValidId } from '@lucentdocs/shared'
import { protectedProcedure, router } from '../index.js'
import { projectSyncBus } from '../project-sync.js'
import type { ProjectSyncEvent } from '../project-sync.js'
import { CHATS_CHANGED_REASONS, DOCUMENTS_CHANGED_REASONS } from '../project-sync.js'
import { observable } from '@trpc/server/observable'
import { assertProjectAccess, subscribeToProjectAccessRevocation } from '../access.js'
import { createSubscriptionLifecycle } from '../subscription-lifecycle.js'

type ProjectsListSyncEvent = Extract<
  ProjectSyncEvent,
  { type: 'project.created' | 'project.updated' | 'project.deleted' }
>

const idSchema = z.string().min(1).max(128).refine(isValidId, { message: 'Invalid ID format' })

const eventBaseSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  createdAt: z.number().int().nonnegative(),
})

const projectCreatedEventSchema = eventBaseSchema.extend({
  audienceUserIds: z.array(idSchema),
  ownerUserId: idSchema,
  type: z.literal('project.created'),
})

const projectUpdatedEventSchema = eventBaseSchema.extend({
  audienceUserIds: z.array(idSchema),
  ownerUserId: idSchema,
  type: z.literal('project.updated'),
})

const projectDeletedEventSchema = eventBaseSchema.extend({
  audienceUserIds: z.array(idSchema),
  ownerUserId: idSchema,
  type: z.literal('project.deleted'),
})

const documentsChangedEventSchema = eventBaseSchema.extend({
  type: z.literal('documents.changed'),
  changedDocumentIds: z.array(idSchema),
  deletedDocumentIds: z.array(idSchema),
  defaultDocumentId: idSchema.nullable(),
  reason: z.enum(DOCUMENTS_CHANGED_REASONS),
})

const chatsChangedEventSchema = eventBaseSchema.extend({
  type: z.literal('chats.changed'),
  documentId: idSchema,
  changedChatIds: z.array(idSchema),
  deletedChatIds: z.array(idSchema),
  reason: z.enum(CHATS_CHANGED_REASONS),
})

const documentUpdatedEventSchema = eventBaseSchema.extend({
  type: z.literal('document.updated'),
  documentId: idSchema,
  changes: z.object({
    title: z.string().optional(),
    updatedAt: z.number().int().nonnegative().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
})

const documentAccessChangedEventSchema = eventBaseSchema.extend({
  type: z.literal('document.access-changed'),
  documentId: idSchema,
})

export const projectSyncEventSchema = z.discriminatedUnion('type', [
  projectCreatedEventSchema,
  projectUpdatedEventSchema,
  projectDeletedEventSchema,
  documentsChangedEventSchema,
  chatsChangedEventSchema,
  documentUpdatedEventSchema,
  documentAccessChangedEventSchema,
])

const projectsListSyncEventSchema = z.discriminatedUnion('type', [
  projectCreatedEventSchema,
  projectUpdatedEventSchema,
  projectDeletedEventSchema,
])

export const syncRouter = router({
  onProjectsListEvent: protectedProcedure.subscription(({ ctx, signal }) => {
    return observable<ProjectsListSyncEvent>((emit) => {
      const lifecycle = createSubscriptionLifecycle(emit, signal)
      lifecycle.addCleanup(
        projectSyncBus.subscribe((event) => {
          if (
            event.type === 'documents.changed' ||
            event.type === 'chats.changed' ||
            event.type === 'document.updated' ||
            event.type === 'document.access-changed'
          ) {
            return
          }

          if (ctx.user.role !== 'admin' && !event.audienceUserIds.includes(ctx.user.id)) {
            return
          }

          lifecycle.next(projectsListSyncEventSchema.parse(event))
        })
      )

      return lifecycle.close
    })
  }),

  onProjectEvent: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
      })
    )
    .subscription(({ ctx, input, signal }) => {
      return observable<ProjectSyncEvent>((emit) => {
        const lifecycle = createSubscriptionLifecycle(emit, signal)

        void (async () => {
          try {
            await assertProjectAccess(ctx, input.projectId)
            if (lifecycle.closed) return

            const stopAccess = subscribeToProjectAccessRevocation(ctx, input.projectId, (error) => {
              lifecycle.error(error)
            })
            lifecycle.addCleanup(stopAccess)
            if (lifecycle.closed) return

            lifecycle.addCleanup(
              projectSyncBus.subscribe((event) => {
                if (event.projectId !== input.projectId) {
                  return
                }

                lifecycle.next(projectSyncEventSchema.parse(event))
              })
            )
          } catch (error) {
            lifecycle.error(error)
          }
        })()

        return lifecycle.close
      })
    }),
})
