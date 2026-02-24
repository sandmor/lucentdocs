export interface ConnectionPort {
  get<T>(sql: string, params: unknown[]): T | undefined
  all<T>(sql: string, params: unknown[]): T[]
  run(sql: string, params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  exec(sql: string): void
}
