import { AsyncLocalStorage } from 'node:async_hooks'

interface TransactionScope {
  id: string
  afterCommit: Array<() => void | Promise<void>>
}

const txScope = new AsyncLocalStorage<TransactionScope>()

export function currentTxId(): string | null {
  return txScope.getStore()?.id ?? null
}

export function runWithTxId<T>(id: string, fn: () => T | Promise<T>): Promise<T> {
  return txScope.run({ id, afterCommit: [] }, () => Promise.resolve(fn()))
}

export function registerAfterCommit(fn: () => void | Promise<void>): boolean {
  const scope = txScope.getStore()
  if (!scope) return false
  scope.afterCommit.push(fn)
  return true
}

export function takeAfterCommitCallbacks(): Array<() => void | Promise<void>> {
  const scope = txScope.getStore()
  if (!scope) return []
  const callbacks = scope.afterCommit
  scope.afterCommit = []
  return callbacks
}
