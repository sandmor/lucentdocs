import type { NativeStorageEngine } from '@lucentdocs/core'
import type { TransactionPort } from '../../core/ports/transaction.port.js'
import { currentTxId, runWithTxId } from './tx-scope.js'

export class RustTransaction implements TransactionPort {
  #queue: Promise<void> = Promise.resolve()

  constructor(private engine: NativeStorageEngine) {}

  async run<T>(fn: () => T | Promise<T>): Promise<T> {
    if (currentTxId() !== null) {
      return fn()
    }

    const execute = async (): Promise<T> => {
      const handle = await this.engine.beginTransaction()
      const txId = handle.id()
      try {
        const result = await runWithTxId(txId, fn)
        await handle.commit()
        return result
      } catch (error) {
        try {
          await handle.rollback()
        } catch {
          void 0
        }
        throw error
      }
    }

    const pending = this.#queue.then(execute, execute)
    this.#queue = pending.then(
      () => undefined,
      () => undefined
    )
    return pending
  }
}

export function createTransaction(engine: NativeStorageEngine): RustTransaction {
  return new RustTransaction(engine)
}
