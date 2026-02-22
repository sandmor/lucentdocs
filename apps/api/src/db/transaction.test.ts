import { expect, test } from 'bun:test'
import { getDb } from './client.js'
import { withTransaction } from './transaction.js'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('keeps non-transaction reads isolated from in-flight transaction writes', async () => {
  const db = await getDb()
  await db.run('DELETE FROM projects')

  const id = 'tx_isolation_project'
  const now = Date.now()

  const tx = withTransaction(async () => {
    const txDb = await getDb()
    await txDb.run(
      'INSERT INTO projects (id, title, metadata, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
      [id, 'isolated', null, now, now]
    )
    await wait(40)
  })

  await wait(10)

  const beforeCommit = await db.get<{ c: number }>(
    'SELECT COUNT(*) as c FROM projects WHERE id = ?',
    [id]
  )
  expect(beforeCommit?.c ?? 0).toBe(0)

  await tx

  const afterCommit = await db.get<{ c: number }>(
    'SELECT COUNT(*) as c FROM projects WHERE id = ?',
    [id]
  )
  expect(afterCommit?.c ?? 0).toBe(1)
})
