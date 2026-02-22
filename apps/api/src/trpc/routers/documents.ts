import { z } from 'zod/v4'
import { TRPCError } from '@trpc/server'
import { router, publicProcedure } from '../index.js'
import { documentsRepo, projectsRepo } from '../../db/index.js'
import {
  isValidId,
  normalizeDocumentPath,
  pathHasSentinelSegment,
  toDirectorySentinelPath,
  type JsonObject,
  type JsonValue,
} from '@plotline/shared'
import { projectSyncBus } from '../project-sync.js'

const idSchema = z.string().min(1).max(128).refine(isValidId, { message: 'Invalid ID format' })
const pathSchema = z.string().trim().min(1).max(400)
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
)
const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema)

async function assertProjectExists(projectId: string): Promise<void> {
  const exists = await projectsRepo.hasProject(projectId)
  if (!exists) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Project ${projectId} not found`,
    })
  }
}

async function getProjectDefaultDocumentId(projectId: string): Promise<string | null> {
  const project = await projectsRepo.getProject(projectId)
  if (!project?.metadata) return null
  const value = project.metadata['default_document']
  return typeof value === 'string' && isValidId(value) ? value : null
}

function normalizeAndValidatePath(inputPath: string, label: string): string {
  const normalized = normalizeDocumentPath(inputPath)
  if (!normalized) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${label} is invalid`,
    })
  }

  if (pathHasSentinelSegment(normalized)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${label} contains a reserved segment`,
    })
  }

  return normalized
}

export const documentsRouter = router({
  list: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
      })
    )
    .query(async ({ input }) => {
      const docs = await documentsRepo.listDocumentsForProject(input.projectId)
      if (docs.length === 0) {
        await assertProjectExists(input.projectId)
      }
      return docs
    }),

  openOrCreateDefault: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
      })
    )
    .mutation(async ({ input }) => {
      const doc = await documentsRepo.openOrCreateDefaultDocumentForProject(input.projectId)
      if (!doc) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Project ${input.projectId} not found`,
        })
      }
      return doc
    }),

  get: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        id: idSchema,
      })
    )
    .query(async ({ input }) => {
      const doc = await documentsRepo.getDocumentForProject(input.projectId, input.id)
      if (!doc) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Document ${input.id} not found in project ${input.projectId}`,
        })
      }
      return doc
    }),

  setDefault: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        id: idSchema,
      })
    )
    .mutation(async ({ input }) => {
      const updated = await documentsRepo.setDefaultDocumentForProject(input.projectId, input.id)
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Document ${input.id} not found in project ${input.projectId}`,
        })
      }

      projectSyncBus.publish({
        type: 'documents.changed',
        projectId: input.projectId,
        reason: 'documents.set-default',
        changedDocumentIds: [input.id],
        deletedDocumentIds: [],
        defaultDocumentId: input.id,
      })

      return { success: true }
    }),

  create: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        title: pathSchema,
      })
    )
    .mutation(async ({ input }) => {
      const normalizedTitle = normalizeAndValidatePath(input.title, 'Document path')
      const doc = await documentsRepo.createDocumentForProject(input.projectId, normalizedTitle)
      if (!doc) {
        const exists = await projectsRepo.hasProject(input.projectId)
        if (!exists) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Project ${input.projectId} not found`,
          })
        }

        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot create document at ${normalizedTitle} due to a path conflict`,
        })
      }

      const defaultDocumentId = await getProjectDefaultDocumentId(input.projectId)
      projectSyncBus.publish({
        type: 'documents.changed',
        projectId: input.projectId,
        reason: 'documents.create',
        changedDocumentIds: [doc.id],
        deletedDocumentIds: [],
        defaultDocumentId,
      })

      return doc
    }),

  update: publicProcedure
    .input(
      z
        .object({
          projectId: idSchema,
          id: idSchema,
          title: pathSchema.optional(),
          metadata: jsonObjectSchema.nullable().optional(),
        })
        .refine((value) => value.title !== undefined || value.metadata !== undefined, {
          message: 'At least one field must be provided',
          path: ['title'],
        })
    )
    .mutation(async ({ input }) => {
      const { projectId, id, title, metadata } = input
      const data: { title?: string; metadata?: JsonObject | null } = { metadata }

      if (title !== undefined) {
        const normalizedTitle = normalizeAndValidatePath(title, 'Document path')
        data.title = normalizedTitle
      }

      const doc = await documentsRepo.updateDocumentForProject(projectId, id, data)
      if (!doc) {
        const exists = await documentsRepo.getDocumentForProject(projectId, id)
        if (!exists) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Document ${id} not found in project ${projectId}`,
          })
        }

        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot update document ${id} due to a path conflict`,
        })
      }

      const defaultDocumentId = await getProjectDefaultDocumentId(projectId)
      projectSyncBus.publish({
        type: 'documents.changed',
        projectId,
        reason: 'documents.update',
        changedDocumentIds: [doc.id],
        deletedDocumentIds: [],
        defaultDocumentId,
      })

      return doc
    }),

  versions: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        id: idSchema,
      })
    )
    .query(async ({ input }) => {
      const versions = await documentsRepo.getVersionHistoryForProject(input.projectId, input.id)
      if (versions.length === 0) {
        const doc = await documentsRepo.getDocumentForProject(input.projectId, input.id)
        if (!doc) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Document ${input.id} not found in project ${input.projectId}`,
          })
        }
      }
      return versions
    }),

  createSnapshot: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        id: idSchema,
      })
    )
    .mutation(async ({ input }) => {
      const snapshot = await documentsRepo.createVersionSnapshotForProject(
        input.projectId,
        input.id
      )
      if (!snapshot) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Document ${input.id} not found in project ${input.projectId}`,
        })
      }
      return snapshot
    }),

  restore: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        id: idSchema,
        snapshotId: idSchema,
      })
    )
    .mutation(async ({ input }) => {
      const doc = await documentsRepo.restoreToSnapshotForProject(
        input.projectId,
        input.id,
        input.snapshotId
      )
      if (!doc) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Document ${input.id} or snapshot ${input.snapshotId} not found in project ${input.projectId}`,
        })
      }
      return doc
    }),

  delete: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        id: idSchema,
      })
    )
    .mutation(async ({ input }) => {
      const deleted = await documentsRepo.deleteDocumentForProject(input.projectId, input.id)
      if (!deleted) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Document ${input.id} not found in project ${input.projectId}`,
        })
      }

      const nextDefaultDocument = await documentsRepo.openOrCreateDefaultDocumentForProject(
        input.projectId
      )
      const defaultDocumentId = nextDefaultDocument?.id ?? null

      projectSyncBus.publish({
        type: 'documents.changed',
        projectId: input.projectId,
        reason: 'documents.delete',
        changedDocumentIds: nextDefaultDocument ? [nextDefaultDocument.id] : [],
        deletedDocumentIds: [input.id],
        defaultDocumentId,
      })

      return { success: true, defaultDocumentId }
    }),

  move: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        id: idSchema,
        path: pathSchema,
      })
    )
    .mutation(async ({ input }) => {
      const normalizedPath = normalizeAndValidatePath(input.path, 'Destination path')
      const moved = await documentsRepo.moveDocumentForProject(
        input.projectId,
        input.id,
        normalizedPath
      )
      if (!moved) {
        const exists = await documentsRepo.getDocumentForProject(input.projectId, input.id)
        if (!exists) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Document ${input.id} not found in project ${input.projectId}`,
          })
        }

        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot move document to ${normalizedPath} due to a path conflict`,
        })
      }

      const defaultDocumentId = await getProjectDefaultDocumentId(input.projectId)
      projectSyncBus.publish({
        type: 'documents.changed',
        projectId: input.projectId,
        reason: 'documents.move',
        changedDocumentIds: [moved.id],
        deletedDocumentIds: [],
        defaultDocumentId,
      })

      return moved
    }),

  createDirectory: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        path: pathSchema,
      })
    )
    .mutation(async ({ input }) => {
      const normalizedPath = normalizeAndValidatePath(input.path, 'Directory path')
      const created = await documentsRepo.createDirectoryForProject(input.projectId, normalizedPath)
      if (!created) {
        const exists = await projectsRepo.hasProject(input.projectId)
        if (!exists) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Project ${input.projectId} not found`,
          })
        }

        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot create directory at ${normalizedPath} due to a path conflict`,
        })
      }

      const defaultDocumentId = await getProjectDefaultDocumentId(input.projectId)
      projectSyncBus.publish({
        type: 'documents.changed',
        projectId: input.projectId,
        reason: 'documents.create-directory',
        changedDocumentIds: [created.id],
        deletedDocumentIds: [],
        defaultDocumentId,
      })

      return { path: normalizedPath }
    }),

  moveDirectory: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        sourcePath: pathSchema,
        destinationPath: pathSchema,
      })
    )
    .mutation(async ({ input }) => {
      const sourcePath = normalizeAndValidatePath(input.sourcePath, 'Source directory path')
      const destinationPath = normalizeAndValidatePath(
        input.destinationPath,
        'Destination directory path'
      )

      const moved = await documentsRepo.moveDirectoryForProject(
        input.projectId,
        sourcePath,
        destinationPath
      )
      if (!moved) {
        const existing = await documentsRepo.listDocumentsForProject(input.projectId)
        const normalizedPaths = existing.map((doc) => normalizeDocumentPath(doc.title))
        const hasSourceDirectory = normalizedPaths.some(
          (path) =>
            path === toDirectorySentinelPath(sourcePath) || path.startsWith(`${sourcePath}/`)
        )
        if (!hasSourceDirectory) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Directory ${sourcePath} not found in project ${input.projectId}`,
          })
        }

        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot move directory ${sourcePath} to ${destinationPath} due to a path conflict`,
        })
      }

      const defaultDocumentId = await getProjectDefaultDocumentId(input.projectId)
      projectSyncBus.publish({
        type: 'documents.changed',
        projectId: input.projectId,
        reason: 'documents.move-directory',
        changedDocumentIds: moved.movedDocumentIds,
        deletedDocumentIds: [],
        defaultDocumentId,
      })

      return moved
    }),

  deleteDirectory: publicProcedure
    .input(
      z.object({
        projectId: idSchema,
        path: pathSchema,
      })
    )
    .mutation(async ({ input }) => {
      const normalizedPath = normalizeAndValidatePath(input.path, 'Directory path')
      const deleted = await documentsRepo.deleteDirectoryForProject(input.projectId, normalizedPath)
      if (!deleted) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Directory ${normalizedPath} not found in project ${input.projectId}`,
        })
      }

      const nextDefaultDocument = await documentsRepo.openOrCreateDefaultDocumentForProject(
        input.projectId
      )
      const defaultDocumentId = nextDefaultDocument?.id ?? null

      projectSyncBus.publish({
        type: 'documents.changed',
        projectId: input.projectId,
        reason: 'documents.delete-directory',
        changedDocumentIds: nextDefaultDocument ? [nextDefaultDocument.id] : [],
        deletedDocumentIds: deleted.deletedDocumentIds,
        defaultDocumentId,
      })

      return deleted
    }),
})
