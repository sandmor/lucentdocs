import { z } from 'zod/v4'

const idSchema = z.string().min(1).max(128)

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
  reason: z.enum([
    'documents.create',
    'documents.update',
    'documents.move',
    'documents.delete',
    'documents.import-many',
    'documents.import-split',
    'documents.create-directory',
    'documents.move-directory',
    'documents.delete-directory',
    'documents.set-default',
    'chat.edit',
  ]),
})

const chatsChangedEventSchema = eventBaseSchema.extend({
  type: z.literal('chats.changed'),
  documentId: idSchema,
  changedChatIds: z.array(idSchema),
  deletedChatIds: z.array(idSchema),
  reason: z.enum(['chats.create', 'chats.update', 'chats.delete']),
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

const projectSyncEventSchema = z.discriminatedUnion('type', [
  projectCreatedEventSchema,
  projectUpdatedEventSchema,
  projectDeletedEventSchema,
  documentsChangedEventSchema,
  chatsChangedEventSchema,
  documentUpdatedEventSchema,
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
