import { z } from 'zod/v4'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../index.js'
import type { ImportDocumentErrorKind } from '../../core/services/documents.service.js'
import {
  isValidId,
  normalizeDocumentPath,
  pathHasSentinelSegment,
  toDirectorySentinelPath,
  parseContent,
  proseMirrorDocToMarkdown,
  type JsonObject,
  type JsonValue,
} from '@lucentdocs/shared'
import { configManager } from '../../config/runtime.js'
import { projectSyncBus } from '../project-sync.js'
import { YJS_RESTORE_CLOSE_CODE, YJS_RESTORE_CLOSE_REASON } from '../../yjs/runtime.js'
import { assertProjectAccess } from '../access.js'
import { normalizeValidatedSearchText } from '../../core/services/documentSearch.js'
import { planMarkdownImport, type MarkdownRawHtmlMode } from '../../core/markdown/native.js'
import { API_JSON_BODY_LIMIT_BYTES } from '../../http/body-limits.js'

const IMPORT_TRANSFER_MAX_BYTES = API_JSON_BODY_LIMIT_BYTES

const idSchema = z.string().min(1).max(128).refine(isValidId, { message: 'Invalid ID format' })
const pathSchema = z.string().trim().min(1).max(1000)
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

function slugifyImportPart(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function estimateJsonPayloadBytes(payload: unknown): number {
  return Buffer.byteLength(JSON.stringify(payload), 'utf8')
}

function assertImportPayloadWithinLimit(payload: unknown): void {
  const bytes = estimateJsonPayloadBytes(payload)
  if (bytes > IMPORT_TRANSFER_MAX_BYTES) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        `Import payload exceeds transfer limit of ${IMPORT_TRANSFER_MAX_BYTES.toLocaleString()} bytes. ` +
        'Split the import into smaller chunks and try again.',
    })
  }
}

function buildSplitImportDocuments(params: {
  fileName: string
  markdown: string
  destinationDirectory: string
  limits: { docImportChars: number }
  split: 'heading' | 'size'
  headingLevel: 1 | 2 | 3
  targetDocChars: number
  rawHtmlMode: MarkdownRawHtmlMode
  includeContents: boolean
}): Array<{ title: string; markdown: string }> {
  const baseName = params.fileName.replace(/\.md$/i, '')
  const folderName = slugifyImportPart(baseName) || 'import'
  const baseDir = normalizeDocumentPath(
    params.destinationDirectory ? `${params.destinationDirectory}/${folderName}` : folderName
  )
  if (!baseDir) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Invalid destination path for import',
    })
  }

  const planResult = planMarkdownImport(params.markdown, {
    maxDocChars: params.limits.docImportChars,
    targetDocChars: Math.min(params.targetDocChars, params.limits.docImportChars),
    split:
      params.split === 'heading'
        ? { type: 'heading', level: params.headingLevel }
        : { type: 'size' },
    rawHtmlMode: params.rawHtmlMode,
  })
  if (!planResult.ok) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        planResult.error.kind === 'parse_failed'
          ? 'Failed to parse markdown while planning import.'
          : 'Failed to plan markdown import.',
    })
  }

  const parts = planResult.value.parts
  if (parts.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Nothing to import',
    })
  }

  const padWidth = String(parts.length + (params.includeContents ? 1 : 0)).length
  const docs: Array<{ title: string; markdown: string }> = []

  if (params.includeContents) {
    const lines = [
      `# ${baseName}`,
      '',
      ...parts.map((part, index) => {
        const n = String(index + 1).padStart(padWidth, '0')
        const title = part.suggestedTitle ?? `Part ${index + 1}`
        return `- ${n} - ${title}`
      }),
      '',
    ]

    docs.push({
      title: `${baseDir}/00-contents.md`,
      markdown: lines.join('\n'),
    })
  }

  for (const [index, part] of parts.entries()) {
    const n = String(index + 1).padStart(padWidth, '0')
    const titleSource = part.suggestedTitle ?? `part-${index + 1}`
    const slug = (slugifyImportPart(titleSource) || `part-${index + 1}`).slice(0, 60)
    docs.push({
      title: `${baseDir}/${n}-${slug}.md`,
      markdown: part.markdown,
    })
  }

  return docs
}

export const documentsRouter = router({
  importLimits: protectedProcedure.query(() => {
    const limits = configManager.getConfig().limits
    return {
      docImportChars: limits.docImportChars,
      docImportBatchDocs: limits.docImportBatchDocs,
      transferMaxBytes: IMPORT_TRANSFER_MAX_BYTES,
    }
  }),

  list: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const docs = await ctx.services.documents.listForProject(input.projectId)
      return docs
    }),

  search: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        query: z.string().trim().min(1),
        limit: z.number().int().min(1).optional(),
        maxSnippetsPerDocument: z.number().int().min(1).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const maxQueryChars = configManager.getConfig().search.maxQueryChars
      try {
        normalizeValidatedSearchText(input.query, maxQueryChars)
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Search query is invalid.',
        })
      }
      return ctx.services.documents.searchForProject(input.projectId, input.query, {
        limit: input.limit,
        maxSnippetsPerDocument: input.maxSnippetsPerDocument,
      })
    }),

  openOrCreateDefault: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const doc = await ctx.services.documents.openOrCreateDefaultForProject(input.projectId)
      if (!doc) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Project ${input.projectId} not found`,
        })
      }
      return doc
    }),

  get: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        id: idSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const doc = await ctx.services.documents.getForProject(input.projectId, input.id)
      if (!doc) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Document ${input.id} not found in project ${input.projectId}`,
        })
      }
      return doc
    }),

  setDefault: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        id: idSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const updated = await ctx.services.documents.setDefaultForProject(input.projectId, input.id)
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

  create: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        title: pathSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const normalizedTitle = normalizeAndValidatePath(input.title, 'Document path')
      const doc = await ctx.services.documents.createForProject(input.projectId, normalizedTitle)
      if (!doc) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot create document at ${normalizedTitle} due to a path conflict`,
        })
      }

      const defaultDocumentId = await ctx.services.documents.getDefaultDocumentIdForProject(
        input.projectId
      )
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

  update: protectedProcedure
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
    .mutation(async ({ ctx, input }) => {
      const { projectId, id, title, metadata } = input
      await assertProjectAccess(ctx, projectId)
      const data: { title?: string; metadata?: JsonObject | null } = { metadata }

      if (title !== undefined) {
        const normalizedTitle = normalizeAndValidatePath(title, 'Document path')
        data.title = normalizedTitle
      }

      const doc = await ctx.services.documents.updateForProject(projectId, id, data)
      if (!doc) {
        const exists = await ctx.services.documents.getForProject(projectId, id)
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

      const defaultDocumentId =
        await ctx.services.documents.getDefaultDocumentIdForProject(projectId)
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

  versions: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        id: idSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const versions = await ctx.services.documents.getVersionHistoryForProject(
        input.projectId,
        input.id
      )
      if (versions.length === 0) {
        const doc = await ctx.services.documents.getForProject(input.projectId, input.id)
        if (!doc) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Document ${input.id} not found in project ${input.projectId}`,
          })
        }
      }
      return versions
    }),

  createSnapshot: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        id: idSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const snapshot = await ctx.services.documents.createSnapshotForProject(
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

  restore: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        id: idSchema,
        snapshotId: idSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const doc = await ctx.services.documents.restoreToSnapshotForProject(
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

      ctx.yjsRuntime.evictLiveDocument(input.id, {
        closeCode: YJS_RESTORE_CLOSE_CODE,
        closeReason: YJS_RESTORE_CLOSE_REASON,
      })
      await ctx.inlineRuntime.pruneOrphanSessions({
        projectId: input.projectId,
        documentId: input.id,
      })

      return doc
    }),

  delete: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        id: idSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const deleted = await ctx.services.documents.deleteForProject(input.projectId, input.id)
      if (!deleted) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Document ${input.id} not found in project ${input.projectId}`,
        })
      }

      ctx.yjsRuntime.evictLiveDocument(input.id)

      const nextDefaultDocument = await ctx.services.documents.openOrCreateDefaultForProject(
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

  move: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        id: idSchema,
        path: pathSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const normalizedPath = normalizeAndValidatePath(input.path, 'Destination path')
      const moved = await ctx.services.documents.moveForProject(
        input.projectId,
        input.id,
        normalizedPath
      )
      if (!moved) {
        const exists = await ctx.services.documents.getForProject(input.projectId, input.id)
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

      const defaultDocumentId = await ctx.services.documents.getDefaultDocumentIdForProject(
        input.projectId
      )
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

  createDirectory: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        path: pathSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const normalizedPath = normalizeAndValidatePath(input.path, 'Directory path')
      const created = await ctx.services.documents.createDirectoryForProject(
        input.projectId,
        normalizedPath
      )
      if (!created) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot create directory at ${normalizedPath} due to a path conflict`,
        })
      }

      const defaultDocumentId = await ctx.services.documents.getDefaultDocumentIdForProject(
        input.projectId
      )
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

  moveDirectory: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        sourcePath: pathSchema,
        destinationPath: pathSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const sourcePath = normalizeAndValidatePath(input.sourcePath, 'Source directory path')
      const destinationPath = normalizeAndValidatePath(
        input.destinationPath,
        'Destination directory path'
      )

      const moved = await ctx.services.documents.moveDirectoryForProject(
        input.projectId,
        sourcePath,
        destinationPath
      )
      if (!moved) {
        const existing = await ctx.services.documents.listForProject(input.projectId)
        const normalizedPaths = existing.map((doc: { title: string }) =>
          normalizeDocumentPath(doc.title)
        )
        const hasSourceDirectory = normalizedPaths.some(
          (path: string) =>
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

      const defaultDocumentId = await ctx.services.documents.getDefaultDocumentIdForProject(
        input.projectId
      )
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

  deleteDirectory: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        path: pathSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const normalizedPath = normalizeAndValidatePath(input.path, 'Directory path')
      const deleted = await ctx.services.documents.deleteDirectoryForProject(
        input.projectId,
        normalizedPath
      )
      if (!deleted) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Directory ${normalizedPath} not found in project ${input.projectId}`,
        })
      }

      for (const deletedDocumentId of deleted.deletedDocumentIds) {
        ctx.yjsRuntime.evictLiveDocument(deletedDocumentId)
      }

      const nextDefaultDocument = await ctx.services.documents.openOrCreateDefaultForProject(
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

  export: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        id: idSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const maxDocExportChars = configManager.getConfig().limits.docExportChars
      const doc = await ctx.services.documents.getForProject(input.projectId, input.id)
      if (!doc) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Document ${input.id} not found in project ${input.projectId}`,
        })
      }

      let markdown = ''
      try {
        const parsed = parseContent(doc.content)
        const markdownResult = proseMirrorDocToMarkdown(parsed.doc)
        if (!markdownResult.ok) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to serialize document to markdown',
          })
        }
        markdown = markdownResult.value
      } catch {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to serialize document to markdown',
        })
      }

      if (markdown.length > maxDocExportChars) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Document export exceeds limit of ${maxDocExportChars} characters`,
        })
      }

      return {
        title: normalizeDocumentPath(doc.title),
        markdown,
      }
    }),

  import: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        title: pathSchema,
        markdown: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)
      const maxDocImportChars = configManager.getConfig().limits.docImportChars
      if (input.markdown.length > maxDocImportChars) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Markdown import exceeds limit of ${maxDocImportChars} characters`,
        })
      }

      const normalizedTitle = normalizeAndValidatePath(input.title, 'Document path')
      const result = await ctx.services.documents.importForProject(
        input.projectId,
        normalizedTitle,
        input.markdown
      )

      if (!result.ok) {
        const errorMessages: Record<
          ImportDocumentErrorKind,
          { code: 'NOT_FOUND' | 'BAD_REQUEST'; message: string }
        > = {
          invalid_project_id: {
            code: 'BAD_REQUEST',
            message: 'Invalid project ID',
          },
          invalid_path: {
            code: 'BAD_REQUEST',
            message: `Cannot import document at ${normalizedTitle}: invalid path`,
          },
          project_not_found: {
            code: 'NOT_FOUND',
            message: `Project ${input.projectId} not found`,
          },
          markdown_parse_failed: {
            code: 'BAD_REQUEST',
            message: 'Failed to parse markdown content',
          },
        }
        const errorKind = result.error.kind as ImportDocumentErrorKind
        const { code, message } = errorMessages[errorKind]
        throw new TRPCError({ code, message })
      }

      const defaultDocumentId = await ctx.services.documents.getDefaultDocumentIdForProject(
        input.projectId
      )
      projectSyncBus.publish({
        type: 'documents.changed',
        projectId: input.projectId,
        reason: 'documents.create',
        changedDocumentIds: [result.doc.id],
        deletedDocumentIds: [],
        defaultDocumentId,
      })

      return result.doc
    }),

  importMany: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        documents: z
          .array(
            z.object({
              title: pathSchema,
              markdown: z.string(),
            })
          )
          .min(1),
        parseFailureMode: z.enum(['fail', 'code_block']).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)

      const limits = configManager.getConfig().limits
      if (input.documents.length > limits.docImportBatchDocs) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Batch import exceeds limit of ${limits.docImportBatchDocs} documents`,
        })
      }

      for (const doc of input.documents) {
        if (doc.markdown.length > limits.docImportChars) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Markdown import exceeds limit of ${limits.docImportChars} characters per document`,
          })
        }
      }

      assertImportPayloadWithinLimit({
        projectId: input.projectId,
        documents: input.documents,
        parseFailureMode: input.parseFailureMode,
      })

      const enqueueResult = await ctx.documentImportRuntime.enqueueImport({
        projectId: input.projectId,
        documents: input.documents,
        parseFailureMode: input.parseFailureMode,
        reason: 'documents.import-many',
      })

      return {
        status: 'queued' as const,
        jobId: enqueueResult.jobId,
        queued: enqueueResult.queued,
        queuedJobs: enqueueResult.queuedJobs,
      }
    }),

  importSplit: protectedProcedure
    .input(
      z.object({
        projectId: idSchema,
        fileName: z.string().trim().min(1).max(512),
        markdown: z.string(),
        destinationDirectory: z.string().trim().optional().default(''),
        split: z.enum(['heading', 'size']),
        headingLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        targetDocChars: z.number().int().min(1),
        rawHtmlMode: z.enum(['drop', 'code_block']).optional().default('code_block'),
        includeContents: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId)

      const limits = configManager.getConfig().limits

      assertImportPayloadWithinLimit({
        projectId: input.projectId,
        fileName: input.fileName,
        markdown: input.markdown,
        destinationDirectory: input.destinationDirectory,
        split: input.split,
        headingLevel: input.headingLevel,
        targetDocChars: input.targetDocChars,
        rawHtmlMode: input.rawHtmlMode,
        includeContents: input.includeContents,
      })

      const destinationDirectory = input.destinationDirectory
        ? normalizeAndValidatePath(input.destinationDirectory, 'Destination directory path')
        : ''

      const plannedDocuments = buildSplitImportDocuments({
        fileName: input.fileName,
        markdown: input.markdown,
        destinationDirectory,
        limits: { docImportChars: limits.docImportChars },
        split: input.split,
        headingLevel: input.headingLevel,
        targetDocChars: input.targetDocChars,
        rawHtmlMode: input.rawHtmlMode,
        includeContents: input.includeContents,
      })

      const enqueueResult = await ctx.documentImportRuntime.enqueueImport({
        projectId: input.projectId,
        documents: plannedDocuments,
        parseFailureMode: 'code_block',
        rawHtmlMode: input.rawHtmlMode,
        reason: 'documents.import-split',
      })

      return {
        status: 'queued' as const,
        jobId: enqueueResult.jobId,
        total: plannedDocuments.length,
        queuedJobs: enqueueResult.queuedJobs,
      }
    }),
})
