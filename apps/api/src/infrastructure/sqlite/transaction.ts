import type { TransactionPort } from '../../core/ports/transaction.port.js'
import type { SqliteConnection } from './connection.js'

export class SqliteTransaction implements TransactionPort {
  #queue: Promise<void> = Promise.resolve()
  #savepointCounter = 0

  constructor(private connection: SqliteConnection) {}

  async run<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.connection.isInScopedConnection()) {
      return this.#runWithSavepoint(fn)
    }

    const execute = async (): Promise<T> => {
      const isolated = this.connection.openIsolatedConnection()
      const txDb = isolated.db
      try {
        txDb.run('BEGIN IMMEDIATE')
        const result = await this.connection.runWithScopedConnection(txDb, fn)
        txDb.run('COMMIT')
        return result
      } catch (error) {
        try {
          txDb.run('ROLLBACK')
        } catch {
          void 0
        }
        throw error
      } finally {
        isolated.close()
      }
    }

    const pending = this.#queue.then(execute, execute)
    this.#queue = pending.then(
      () => undefined,
      () => undefined
    )
    return pending
  }

  async #runWithSavepoint<T>(fn: () => T | Promise<T>): Promise<T> {
    const savepoint = `sp_${++this.#savepointCounter}`
    this.connection.exec(`SAVEPOINT ${savepoint}`)

    try {
      const result = await fn()
      this.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
      return result
    } catch (error) {
      try {
        this.connection.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
      } finally {
        this.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
      }
      throw error
    }
  }
}

export function createTransaction(connection: SqliteConnection): SqliteTransaction {
  return new SqliteTransaction(connection)
}
