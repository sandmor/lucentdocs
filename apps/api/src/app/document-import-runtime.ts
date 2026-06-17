import { z } from 'zod/v4'
import type { NativeStorageEngine } from '@lucentdocs/core'
import type { RepositorySet } from '../core/ports/types.js'
import type { JobQueuePort, QueueJobEnvelope } from '../core/ports/jobQueue.port.js'
import type { ServiceSet } from '../core/services/types.js'
import { DOCUMENT_IMPORT_JOB_TYPE } from '../core/jobs/job-types.js'

export { DOCUMENT_IMPORT_JOB_TYPE }
import {
  runNativeMassImport,
  type MarkdownRawHtmlMode,
  type NativeMassImportDocumentInput,
  type NativeMassImportFailure,
} from '../core/markdown/native.js'
import { projectSyncBus, type DocumentsChangedReason } from '../trpc/project-sync.js'
import { DOCUMENTS_CHANGED_REASONS } from './project-sync.js'

export interface DocumentImportJob {
  projectId: string
  documents: NativeMassImportDocumentInput[]
  parseFailureMode?: 'fail' | 'code_block'
  rawHtmlMode?: MarkdownRawHtmlMode
  reason: DocumentsChangedReason
}

export interface EnqueueImportRequest {
  projectId: string
  documents: NativeMassImportDocumentInput[]
  parseFailureMode?: 'fail' | 'code_block'
  rawHtmlMode?: MarkdownRawHtmlMode
  reason: DocumentsChangedReason
}

export interface EnqueueImportResult {
  jobId: string
  queued: number
  queuedJobs: number
}

export interface DocumentImportRuntime {
  enqueueImport(request: EnqueueImportRequest): Promise<EnqueueImportResult>
}

const documentImportJobSchema = z.object({
  projectId: z.string().min(1),
  documents: z.array(
    z.object({
      title: z.string(),
      markdown: z.string(),
    })
  ),
  parseFailureMode: z.enum(['fail', 'code_block']).optional(),
  rawHtmlMode: z.enum(['drop', 'code_block']).optional(),
  reason: z.enum(DOCUMENTS_CHANGED_REASONS),
})

export function createDocumentImportRuntime(options: {
  queue: JobQueuePort
}): DocumentImportRuntime {
  return {
    async enqueueImport(request: EnqueueImportRequest): Promise<EnqueueImportResult> {
      const queuedJob = await options.queue.enqueue<DocumentImportJob>({
        type: DOCUMENT_IMPORT_JOB_TYPE,
        payload: {
          projectId: request.projectId,
          documents: request.documents,
          parseFailureMode: request.parseFailureMode,
          rawHtmlMode: request.rawHtmlMode,
          reason: request.reason,
        },
      })

      return {
        jobId: queuedJob.id,
        queued: request.documents.length,
        queuedJobs: 1,
      }
    },
  }
}

export function createDocumentImportJobHandler(options: {
  engine: NativeStorageEngine
  services: ServiceSet
  repositories: RepositorySet
}): (job: QueueJobEnvelope<unknown>) => Promise<void> {
  async function runJob(jobId: string, job: DocumentImportJob): Promise<void> {
    const importResult = await runNativeMassImport(options.engine, {
      projectId: job.projectId,
      documents: job.documents,
      parseFailureMode: job.parseFailureMode,
      rawHtmlMode: job.rawHtmlMode,
    })

    if (importResult.failed.length > 0) {
      const failures: NativeMassImportFailure[] = importResult.failed
      const markdownFailureCount = failures.filter(
        (failure) => failure.error.kind === 'markdown_parse_failed'
      ).length
      if (markdownFailureCount > 0) {
        console.warn(
          `Import job ${jobId} completed with ${markdownFailureCount} markdown parse failures.`
        )
      }
    }

    if (importResult.imported.length === 0) {
      return
    }

    const importedIds = importResult.imported.map((document) => document.id)
    if (importedIds.length === 0) {
      return
    }

    const queuedAt = Date.now()
    await options.repositories.embeddingIndexQueue.enqueueDocuments(
      importedIds,
      queuedAt,
      queuedAt
    )

    const defaultDocumentId = await options.services.documents.getDefaultDocumentIdForProject(
      job.projectId
    )
    projectSyncBus.publish({
      type: 'documents.changed',
      projectId: job.projectId,
      reason: job.reason,
      changedDocumentIds: importedIds,
      deletedDocumentIds: [],
      defaultDocumentId,
    })
  }

  return async (envelope: QueueJobEnvelope<unknown>) => {
    const parsedJob = documentImportJobSchema.safeParse(envelope.payload)
    if (!parsedJob.success) {
      throw new Error(`Invalid payload for job ${envelope.id} (${envelope.type}).`)
    }
    const job: DocumentImportJob = parsedJob.data

    try {
      await runJob(envelope.id, job)
    } catch (error) {
      console.error('Background import job failed', {
        jobId: envelope.id,
        projectId: job.projectId,
        error,
      })
      throw error
    }
  }
}
