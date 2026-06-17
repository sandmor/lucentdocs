import { AsyncLocalStorage } from 'node:async_hooks'

const txScope = new AsyncLocalStorage<string>()

export function currentTxId(): string | null {
  return txScope.getStore() ?? null
}

export function runWithTxId<T>(id: string, fn: () => T | Promise<T>): Promise<T> {
  return txScope.run(id, () => Promise.resolve(fn()))
}
