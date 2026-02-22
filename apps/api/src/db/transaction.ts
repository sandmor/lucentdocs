import { getDb, getScopedDb, openIsolatedDbConnection, runWithDbContext } from './client.js'

let transactionQueue: Promise<void> = Promise.resolve()

export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  // Nested transactions reuse the existing transaction connection.
  if (getScopedDb()) {
    return fn()
  }

  let releaseQueue!: () => void
  const previous = transactionQueue
  transactionQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve
  })

  await previous

  await getDb()
  const db = await openIsolatedDbConnection()
  try {
    await db.exec('BEGIN IMMEDIATE')
    const result = await runWithDbContext(db, fn)
    await db.exec('COMMIT')
    return result
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await db.close().catch(() => {})
    releaseQueue()
  }
}
