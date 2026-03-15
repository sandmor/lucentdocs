import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteAdapter } from '../infrastructure/sqlite/factory.js'
import { InMemoryJobQueue } from '../infrastructure/queue/in-memory-job-queue.adapter.js'
import { createDocumentImportRuntime, type DocumentImportJob } from './document-import-runtime.js'

const isTargetedStressRun = process.argv.some((arg) =>
  arg.includes('document-import-runtime.stress.test')
)
const runImportStressTests =
  process.env.LUCENTDOCS_ENABLE_IMPORT_STRESS === '1' &&
  (isTargetedStressRun || process.env.LUCENTDOCS_RUN_STRESS_IN_FULL_SUITE === '1')
const describeImportStress = runImportStressTests ? describe : describe.skip

async function waitFor(
  check: () => Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 60_000
  const intervalMs = options.intervalMs ?? 20
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Timed out after ${timeoutMs}ms while waiting for background import`)
}

describeImportStress('DocumentImportRuntime stress', () => {
  test('keeps sqlite database integrity after giant queued import', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plotline-doc-import-stress-'))
    const dbPath = join(dir, 'sqlite.db')
    const adapter = createSqliteAdapter(dbPath)

    try {
      const ownerUserId = 'owner_1'
      const project = await adapter.services.projects.create('Stress Import', { ownerUserId })
      const runtime = createDocumentImportRuntime({
        dbPath,
        services: adapter.services,
        repositories: adapter.repositories,
        transaction: adapter.transaction,
        queue: new InMemoryJobQueue<DocumentImportJob>(),
        hooks: {
          afterExternalWriteCommit: () => adapter.connection.refreshPrimaryConnection(),
        },
      })

      const totalDocs = 300
      const documents = Array.from({ length: totalDocs }, (_value, index) => ({
        title: `stress/stress-${index + 1}.md`,
        markdown: `# Stress ${index + 1}\n\nThis is stress doc ${index + 1}.`,
      }))

      runtime.enqueueImport({
        projectId: project.id,
        documents,
        parseFailureMode: 'fail',
        reason: 'documents.import-many',
      })

      await waitFor(async () => {
        const docs = await adapter.services.documents.listForProject(project.id)
        return docs.length === totalDocs
      })

      await waitFor(async () => {
        const queue = await adapter.repositories.documentEmbeddings.listQueuedDocuments()
        return queue.length === totalDocs
      })

      const integrityRow = adapter.connection.get<{ integrity_check: string }>(
        'PRAGMA integrity_check',
        []
      )
      expect(integrityRow?.integrity_check).toBe('ok')
    } finally {
      adapter.connection.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 90_000)

  test('keeps integrity across back-to-back giant imports', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plotline-doc-import-stress-back-to-back-'))
    const dbPath = join(dir, 'sqlite.db')
    const adapter = createSqliteAdapter(dbPath)

    try {
      const ownerUserId = 'owner_1'
      const project = await adapter.services.projects.create('Stress Import', { ownerUserId })
      const runtime = createDocumentImportRuntime({
        dbPath,
        services: adapter.services,
        repositories: adapter.repositories,
        transaction: adapter.transaction,
        queue: new InMemoryJobQueue<DocumentImportJob>(),
        hooks: {
          afterExternalWriteCommit: () => adapter.connection.refreshPrimaryConnection(),
        },
      })

      const batchSize = 300
      const firstBatch = Array.from({ length: batchSize }, (_value, index) => ({
        title: `stress-a/doc-${index + 1}.md`,
        markdown: `# A ${index + 1}\n\nBack to back import A ${index + 1}.`,
      }))
      const secondBatch = Array.from({ length: batchSize }, (_value, index) => ({
        title: `stress-b/doc-${index + 1}.md`,
        markdown: `# B ${index + 1}\n\nBack to back import B ${index + 1}.`,
      }))

      runtime.enqueueImport({
        projectId: project.id,
        documents: firstBatch,
        parseFailureMode: 'fail',
        reason: 'documents.import-many',
      })

      await waitFor(async () => {
        const docs = await adapter.services.documents.listForProject(project.id)
        return docs.length === batchSize
      })

      runtime.enqueueImport({
        projectId: project.id,
        documents: secondBatch,
        parseFailureMode: 'fail',
        reason: 'documents.import-many',
      })

      await waitFor(async () => {
        const docs = await adapter.services.documents.listForProject(project.id)
        return docs.length === batchSize * 2
      })

      await waitFor(async () => {
        const queue = await adapter.repositories.documentEmbeddings.listQueuedDocuments()
        return queue.length === batchSize * 2
      })

      const integrityRow = adapter.connection.get<{ integrity_check: string }>(
        'PRAGMA integrity_check',
        []
      )
      expect(integrityRow?.integrity_check).toBe('ok')
    } finally {
      adapter.connection.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)

  test('keeps integrity when giant imports are queued for multiple projects', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plotline-doc-import-stress-multi-project-'))
    const dbPath = join(dir, 'sqlite.db')
    const adapter = createSqliteAdapter(dbPath)

    try {
      const ownerUserId = 'owner_1'
      const projectA = await adapter.services.projects.create('Stress A', { ownerUserId })
      const projectB = await adapter.services.projects.create('Stress B', { ownerUserId })
      const runtime = createDocumentImportRuntime({
        dbPath,
        services: adapter.services,
        repositories: adapter.repositories,
        transaction: adapter.transaction,
        queue: new InMemoryJobQueue<DocumentImportJob>(),
        hooks: {
          afterExternalWriteCommit: () => adapter.connection.refreshPrimaryConnection(),
        },
      })

      const batchSize = 250
      const docsA = Array.from({ length: batchSize }, (_value, index) => ({
        title: `a/doc-${index + 1}.md`,
        markdown: `# A ${index + 1}\n\nProject A ${index + 1}.`,
      }))
      const docsB = Array.from({ length: batchSize }, (_value, index) => ({
        title: `b/doc-${index + 1}.md`,
        markdown: `# B ${index + 1}\n\nProject B ${index + 1}.`,
      }))

      runtime.enqueueImport({
        projectId: projectA.id,
        documents: docsA,
        parseFailureMode: 'fail',
        reason: 'documents.import-many',
      })
      runtime.enqueueImport({
        projectId: projectB.id,
        documents: docsB,
        parseFailureMode: 'fail',
        reason: 'documents.import-many',
      })

      await waitFor(async () => {
        const [projectDocsA, projectDocsB] = await Promise.all([
          adapter.services.documents.listForProject(projectA.id),
          adapter.services.documents.listForProject(projectB.id),
        ])
        return projectDocsA.length === batchSize && projectDocsB.length === batchSize
      })

      await waitFor(async () => {
        const queue = await adapter.repositories.documentEmbeddings.listQueuedDocuments()
        return queue.length === batchSize * 2
      })

      const integrityRow = adapter.connection.get<{ integrity_check: string }>(
        'PRAGMA integrity_check',
        []
      )
      expect(integrityRow?.integrity_check).toBe('ok')
    } finally {
      adapter.connection.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
