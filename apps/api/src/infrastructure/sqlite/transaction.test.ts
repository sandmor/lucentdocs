import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createConnection } from './connection.js'
import { createTransaction } from './transaction.js'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('keeps non-transaction reads isolated from in-flight transaction writes', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'plotline-sqlite-tx-'))
  const dbPath = join(tempDir, 'test.db')

  const connection = createConnection(dbPath)
  const transaction = createTransaction(connection)

  try {
    connection.run('DELETE FROM projects', [])

    const id = 'tx_isolation_project'
    const now = Date.now()

    const tx = transaction.run(async () => {
      connection.run(
        'INSERT INTO projects (id, title, metadata, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
        [id, 'isolated', null, now, now]
      )
      await wait(40)
    })

    await wait(10)

    const beforeCommit = connection.get<{ c: number }>(
      'SELECT COUNT(*) as c FROM projects WHERE id = ?',
      [id]
    )
    expect(beforeCommit?.c ?? 0).toBe(0)

    await tx

    const afterCommit = connection.get<{ c: number }>(
      'SELECT COUNT(*) as c FROM projects WHERE id = ?',
      [id]
    )
    expect(afterCommit?.c ?? 0).toBe(1)
  } finally {
    connection.close()
    rmSync(tempDir, { recursive: true, force: true })
  }
})
