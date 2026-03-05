import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { ConnectionPort } from '../../core/ports/connection.port.js'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    metadata TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'manuscript',
    metadata TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);

  CREATE TABLE IF NOT EXISTS project_documents (
    projectId TEXT NOT NULL,
    documentId TEXT NOT NULL,
    addedAt INTEGER NOT NULL,
    PRIMARY KEY (projectId, documentId),
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS yjs_documents (
    name TEXT PRIMARY KEY,
    data BLOB NOT NULL
  );

  CREATE TABLE IF NOT EXISTS version_snapshots (
    id TEXT PRIMARY KEY,
    documentId TEXT NOT NULL,
    content TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_version_snapshots_document ON version_snapshots(documentId);

  CREATE TABLE IF NOT EXISTS chat_threads (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    documentId TEXT NOT NULL,
    title TEXT NOT NULL,
    messages TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_chat_threads_document_updated
    ON chat_threads(projectId, documentId, updatedAt DESC);

  CREATE TABLE IF NOT EXISTS ai_provider_configs (
    id TEXT PRIMARY KEY,
    providerId TEXT NOT NULL,
    type TEXT NOT NULL,
    baseUrl TEXT NOT NULL,
    model TEXT NOT NULL,
    apiKeyId TEXT,
    sortOrder INTEGER NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (apiKeyId) REFERENCES ai_api_keys(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_ai_provider_configs_order
    ON ai_provider_configs(sortOrder ASC, createdAt ASC);

  CREATE TABLE IF NOT EXISTS ai_api_keys (
    id TEXT PRIMARY KEY,
    baseUrl TEXT NOT NULL,
    name TEXT NOT NULL,
    apiKey TEXT NOT NULL,
    isDefault INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_ai_api_keys_base_url
    ON ai_api_keys(baseUrl ASC, isDefault DESC, updatedAt DESC);

  WITH ranked_defaults AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY baseUrl
        ORDER BY updatedAt DESC, createdAt DESC, id DESC
      ) AS rowNum
    FROM ai_api_keys
    WHERE isDefault = 1
  )
  UPDATE ai_api_keys
  SET isDefault = 0
  WHERE id IN (SELECT id FROM ranked_defaults WHERE rowNum > 1);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_api_keys_single_default
    ON ai_api_keys(baseUrl)
    WHERE isDefault = 1;

  CREATE TABLE IF NOT EXISTS ai_runtime_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    activeProviderId TEXT,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (activeProviderId) REFERENCES ai_provider_configs(id) ON DELETE SET NULL
  );
`

export class SqliteConnection implements ConnectionPort {
  #dbPath: string
  #db: Database
  #scope = new AsyncLocalStorage<Database>()

  constructor(dbPath: string) {
    this.#dbPath = dbPath === ':memory:' ? dbPath : resolve(dbPath)
    const dir = this.#dbPath !== ':memory:' ? dirname(this.#dbPath) : null
    if (dir) {
      mkdirSync(dir, { recursive: true })
    }

    this.#db = new Database(this.#dbPath)
    this.#configureDatabase(this.#db, { enableWal: true })
    this.#db.exec(SCHEMA)
  }

  get<T>(sql: string, params: unknown[]): T | undefined {
    const stmt = this.#getActiveDb().query(sql)
    return stmt.get(...(params as Parameters<typeof stmt.get>)) as T | undefined
  }

  all<T>(sql: string, params: unknown[]): T[] {
    const stmt = this.#getActiveDb().query(sql)
    return stmt.all(...(params as Parameters<typeof stmt.all>)) as T[]
  }

  run(sql: string, params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    const stmt = this.#getActiveDb().query(sql)
    const result = stmt.run(...(params as Parameters<typeof stmt.run>))
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
  }

  exec(sql: string): void {
    this.#getActiveDb().exec(sql)
  }

  transaction<T>(fn: () => T): T {
    return this.#getActiveDb().transaction(fn)()
  }

  isInScopedConnection(): boolean {
    return this.#scope.getStore() !== undefined
  }

  runWithScopedConnection<T>(db: Database, fn: () => T | Promise<T>): Promise<T> {
    return this.#scope.run(db, () => Promise.resolve(fn()))
  }

  openIsolatedConnection(): { db: Database; close: () => void } {
    if (this.#dbPath === ':memory:') {
      return { db: this.#db, close: () => {} }
    }

    const isolated = new Database(this.#dbPath)
    this.#configureDatabase(isolated, { enableWal: true })
    isolated.exec(SCHEMA)
    return {
      db: isolated,
      close: () => {
        isolated.close()
      },
    }
  }

  close(): void {
    this.#db.close()
  }

  getRaw(): Database {
    return this.#db
  }

  #getActiveDb(): Database {
    return this.#scope.getStore() ?? this.#db
  }

  #configureDatabase(db: Database, options: { enableWal: boolean }): void {
    if (options.enableWal) {
      db.run('PRAGMA journal_mode = WAL')
    }
    db.run('PRAGMA foreign_keys = ON')
    db.run('PRAGMA busy_timeout = 5000')
  }
}

export function createConnection(dbPath: string): SqliteConnection {
  return new SqliteConnection(dbPath)
}
