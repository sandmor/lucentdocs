import { z } from 'zod/v4'
import { isValidId } from '@lucentdocs/shared'
import { protectedProcedure, router } from '../index.js'
import { projectSyncBus } from '../project-sync.js'
import type { ProjectSyncEvent } from '../project-sync.js'
import { CHATS_CHANGED_REASONS, DOCUMENTS_CHANGED_REASONS } from '../project-sync.js'
import { observable } from '@trpc/server/observable'
import { assertProjectAccess, subscribeToProjectAccessRevocation } from '../access.js'

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

export const projectSyncEventSchema = z.discriminatedUnion('type', [
  projectCreatedEventSchema,
  projectUpdatedEventSchema,
  projectDeletedEventSchema,
  documentsChangedEventSchema,
  chatsChangedEventSchema,
])

const projectsListSyncEventSchema = z.discriminatedUnion('type', [
  projectCreatedEventSchema,
  projectUpdatedEventSchema,
  projectDeletedEventSchema,
])

export const syncRouter = router({
  onProjectsListEvent: protectedProcedure.subscription(({ ctx, signal }) => {
    return observable<ProjectsListSyncEvent>((emit) => {
      const unsubscribe = projectSyncBus.subscribe((event) => {
        if (event.type === 'documents.changed' || event.type === 'chats.changed') {
          return
        }

        if (ctx.user.role !== 'admin' && !event.audienceUserIds.includes(ctx.user.id)) {
          return
        }

        emit.next(projectsListSyncEventSchema.parse(event))
      })

      const onAbort = () => {
        unsubscribe()
      }

      signal?.addEventListener('abort', onAbort)

      return () => {
        signal?.removeEventListener('abort', onAbort)
        unsubscribe()
      }
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
        let unsubscribe: (() => void) | null = null
        let unsubscribeAccess: (() => void) | null = null
        let closed = false

        void assertProjectAccess(ctx, input.projectId)
          .then(() => {
            unsubscribeAccess = subscribeToProjectAccessRevocation(
              ctx,
              input.projectId,
              (error) => {
                if (closed) return
                closed = true
                unsubscribe?.()
                unsubscribeAccess?.()
                emit.error(error)
              }
            )

            unsubscribe = projectSyncBus.subscribe((event) => {
              if (event.projectId !== input.projectId) {
                return
              }

              emit.next(projectSyncEventSchema.parse(event))
            })
          })
          .catch((error) => {
            emit.error(error)
          })

        const onAbort = () => {
          closed = true
          unsubscribe?.()
          unsubscribeAccess?.()
        }

        signal?.addEventListener('abort', onAbort)

        return () => {
          closed = true
          signal?.removeEventListener('abort', onAbort)
          unsubscribe?.()
          unsubscribeAccess?.()
        }
      })
    }),
})
