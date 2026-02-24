export interface TransactionPort {
  run<T>(fn: () => T | Promise<T>): Promise<T>
}
