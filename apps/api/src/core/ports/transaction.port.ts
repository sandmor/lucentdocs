export interface TransactionPort {
  run<T>(fn: () => T | Promise<T>): Promise<T>
  /** Runs only after the outermost active transaction has committed. */
  afterCommit(fn: () => void | Promise<void>): void
}
