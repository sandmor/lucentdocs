import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestAdapter } from '../../testing/factory.js'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('keeps non-transaction reads isolated from in-flight transaction writes', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'lucentdocs-rust-tx-'))
  const dbPath = join(tempDir, 'test.db')
  const adapter = createTestAdapter({ dbPath })

  try {
    const id = 'tx_isolation_project'
    const now = Date.now()

    const tx = adapter.transaction.run(async () => {
      await adapter.repositories.projects.insert({
        id,
        title: 'isolated',
        ownerUserId: 'owner_tx',
        metadata: null,
        createdAt: now,
        updatedAt: now,
      })
      await wait(40)
    })

    await wait(10)

    const beforeCommit = await adapter.repositories.projects.findById(id)
    expect(beforeCommit).toBeUndefined()

    await tx

    const afterCommit = await adapter.repositories.projects.findById(id)
    expect(afterCommit?.id).toBe(id)
  } finally {
    void adapter.adapter.engine.close()
    rmSync(tempDir, { recursive: true, force: true })
  }
})
