import { nanoid } from 'nanoid'
import { parseContent, type JsonObject } from '@lucentdocs/shared'
import * as Y from 'yjs'
import { prosemirrorJSONToYDoc } from 'y-prosemirror'
import type { RepositorySet } from '../core/ports/types.js'
import type { TransactionPort } from '../core/ports/transaction.port.js'
import type { JobQueuePort } from '../core/ports/jobQueue.port.js'
import type { ServiceSet } from '../core/services/types.js'
import {
  runNativeMassImportSqlite,
  type MarkdownRawHtmlMode,
  type NativeMassImportDocumentInput,
  type NativeMassImportFailure,
} from '../core/markdown/native.js'
import { projectSyncBus, type DocumentsChangedReason } from '../trpc/project-sync.js'

export interface DocumentImportJob {
  id: string
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
  enqueueImport(request: EnqueueImportRequest): EnqueueImportResult
}

/**
 * Optional hook for adapters that need to synchronize their read/write handles
 * after an external/native writer commits changes to the same database.
 *
 * SQLite (Bun + NAPI/sqlx) uses this to refresh the Bun connection after native
 * batch imports. Adapters like Postgres can safely provide no-op hooks.
 */
export interface ExternalWriteSynchronizationHooks {
  afterExternalWriteCommit?: () => void
}

export function createDocumentImportRuntime(options: {
  dbPath: string
  services: ServiceSet
  repositories: RepositorySet
  transaction: TransactionPort
  queue: JobQueuePort<DocumentImportJob>
  hooks?: ExternalWriteSynchronizationHooks
}): DocumentImportRuntime {
  async function settleImportedDocumentIds(importedIds: string[]): Promise<string[]> {
    if (importedIds.length === 0) return []

    const expected = new Set(importedIds)
    const maxAttempts = 20
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const docs = await options.repositories.documents.findByIds(importedIds)
      const visibleIds = docs.map((doc) => doc.id).filter((id) => expected.has(id))
      if (visibleIds.length === importedIds.length) {
        return visibleIds
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    const docs = await options.repositories.documents.findByIds(importedIds)
    const visible = docs.map((doc) => doc.id).filter((id) => expected.has(id))
    if (visible.length !== importedIds.length) {
      console.warn('Imported document visibility lagged on Bun connection', {
        expected: importedIds.length,
        visible: visible.length,
      })
    }
    return visible
  }

  async function persistYjsContent(
    imported: Array<{ id: string; contentJson: string }>
  ): Promise<string[]> {
    if (imported.length === 0) return []

    const { schema } = await import('@lucentdocs/shared')
    const validUpdates: Array<{ documentId: string; blob: Buffer }> = []
    const cleanupDocumentIds: string[] = []

    for (const document of imported) {
      try {
        const parsed = parseContent(document.contentJson)
        const ydoc = prosemirrorJSONToYDoc(schema, parsed.doc as JsonObject)
        const blob = Y.encodeStateAsUpdate(ydoc)
        ydoc.destroy()
        validUpdates.push({ documentId: document.id, blob: Buffer.from(blob) })
      } catch (error) {
        console.error('Failed to persist imported Yjs content for document', document.id, error)
        cleanupDocumentIds.push(document.id)
      }
    }

    await options.transaction.run(async () => {
      for (const update of validUpdates) {
        await options.repositories.yjsDocuments.set(update.documentId, update.blob)
      }

      for (const documentId of cleanupDocumentIds) {
        await options.repositories.yjsDocuments.delete(documentId)
        await options.repositories.documents.deleteById(documentId)
      }
    })

    return validUpdates.map((item) => item.documentId)
  }

  async function runJob(job: DocumentImportJob): Promise<void> {
    const importResult = await runNativeMassImportSqlite(options.dbPath, {
      projectId: job.projectId,
      documents: job.documents,
      parseFailureMode: job.parseFailureMode,
      rawHtmlMode: job.rawHtmlMode,
    })

    options.hooks?.afterExternalWriteCommit?.()

    if (importResult.failed.length > 0) {
      const failures: NativeMassImportFailure[] = importResult.failed
      const markdownFailureCount = failures.filter(
        (failure) => failure.error.kind === 'markdown_parse_failed'
      ).length
      if (markdownFailureCount > 0) {
        console.warn(
          `Import job ${job.id} completed with ${markdownFailureCount} markdown parse failures.`
        )
      }
    }

    if (importResult.imported.length === 0) {
      return
    }

    const importedIds = await persistYjsContent(
      importResult.imported.map((document) => ({
        id: document.id,
        contentJson: document.contentJson,
      }))
    )

    if (importedIds.length === 0) {
      return
    }

    const visibleImportedIds = await settleImportedDocumentIds(importedIds)
    if (visibleImportedIds.length === 0) {
      return
    }

    const queuedAt = Date.now()
    await options.repositories.documentEmbeddings.enqueueDocuments(
      visibleImportedIds,
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
      changedDocumentIds: visibleImportedIds,
      deletedDocumentIds: [],
      defaultDocumentId,
    })
  }

  options.queue.start(async (job) => {
    try {
      await runJob(job)
    } catch (error) {
      console.error('Background import job failed', {
        jobId: job.id,
        projectId: job.projectId,
        error,
      })
    }
  })

  return {
    enqueueImport(request: EnqueueImportRequest): EnqueueImportResult {
      const job: DocumentImportJob = {
        id: nanoid(),
        projectId: request.projectId,
        documents: request.documents,
        parseFailureMode: request.parseFailureMode,
        rawHtmlMode: request.rawHtmlMode,
        reason: request.reason,
      }

      void options.queue.enqueue(job)

      return {
        jobId: job.id,
        queued: request.documents.length,
        queuedJobs: 1,
      }
    },
  }
}
