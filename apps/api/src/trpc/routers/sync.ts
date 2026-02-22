import { z } from 'zod/v4'
import { isValidId } from '@plotline/shared'
import { router, publicProcedure } from '../index.js'
import { projectSyncBus } from '../project-sync.js'
import type { ProjectSyncEvent } from '../project-sync.js'
import { observable } from '@trpc/server/observable'

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
  type: z.literal('project.created'),
})

const projectUpdatedEventSchema = eventBaseSchema.extend({
  type: z.literal('project.updated'),
})

const projectDeletedEventSchema = eventBaseSchema.extend({
  type: z.literal('project.deleted'),
})

const documentsChangedEventSchema = eventBaseSchema.extend({
  type: z.literal('documents.changed'),
  changedDocumentIds: z.array(idSchema),
  deletedDocumentIds: z.array(idSchema),
  defaultDocumentId: idSchema.nullable(),
  reason: z.enum([
    'documents.create',
    'documents.update',
    'documents.move',
    'documents.delete',
    'documents.create-directory',
    'documents.move-directory',
    'documents.delete-directory',
    'documents.set-default',
  ]),
})

const projectSyncEventSchema = z.discriminatedUnion('type', [
  projectCreatedEventSchema,
  projectUpdatedEventSchema,
  projectDeletedEventSchema,
  documentsChangedEventSchema,
])

const projectsListSyncEventSchema = z.discriminatedUnion('type', [
  projectCreatedEventSchema,
  projectUpdatedEventSchema,
  projectDeletedEventSchema,
])

export const syncRouter = router({
  onProjectsListEvent: publicProcedure.subscription(({ signal }) => {
    return observable<ProjectsListSyncEvent>((emit) => {
      const unsubscribe = projectSyncBus.subscribe((event) => {
        if (event.type === 'documents.changed') {
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

  onProjectEvent: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
      })
    )
    .subscription(({ input, signal }) => {
      return observable<ProjectSyncEvent>((emit) => {
        const unsubscribe = projectSyncBus.subscribe((event) => {
          if (event.projectId !== input.projectId) {
            return
          }

          emit.next(projectSyncEventSchema.parse(event))
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
})
