import { z } from 'zod/v4'

const idSchema = z.string().min(1).max(128)

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

export type ProjectSyncEvent = z.infer<typeof projectSyncEventSchema>
export type ProjectsListSyncEvent = z.infer<typeof projectsListSyncEventSchema>

export function parseProjectSyncEvent(value: unknown): ProjectSyncEvent | null {
  const parsed = projectSyncEventSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseProjectsListSyncEvent(value: unknown): ProjectsListSyncEvent | null {
  const parsed = projectsListSyncEventSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
