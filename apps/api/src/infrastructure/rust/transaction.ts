import type { NativeStorageEngine } from '@lucentdocs/core'
import type { TransactionPort } from '../../core/ports/transaction.port.js'
import {
  currentTxId,
  registerAfterCommit,
  runWithTxId,
  takeAfterCommitCallbacks,
} from './tx-scope.js'

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
        const { result, callbacks } = await runWithTxId(txId, async () => ({
          result: await fn(),
          callbacks: takeAfterCommitCallbacks(),
        }))
        await handle.commit()
        for (const callback of callbacks) {
          try {
            await callback()
          } catch (error) {
            console.warn('Post-commit callback failed:', error)
          }
        }
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

  afterCommit(fn: () => void | Promise<void>): void {
    if (registerAfterCommit(fn)) return
    void Promise.resolve(fn()).catch((error) => {
      console.warn('Post-commit callback failed outside a transaction:', error)
    })
  }
}

export function createTransaction(engine: NativeStorageEngine): RustTransaction {
  return new RustTransaction(engine)
}
