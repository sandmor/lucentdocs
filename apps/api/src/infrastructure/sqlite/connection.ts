import { Database } from 'bun:sqlite'
import * as sqliteVec from 'sqlite-vec'
import { mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { ConnectionPort } from '../../core/ports/connection.port.js'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    ownerUserId TEXT NOT NULL,
    metadata TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_projects_owner_user_id ON projects(ownerUserId);

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
    usage TEXT NOT NULL CHECK (usage IN ('generation', 'embedding')),
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
    ON ai_provider_configs(usage ASC, sortOrder ASC, createdAt ASC);

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
    activeGenerationProviderId TEXT,
    activeEmbeddingProviderId TEXT,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (activeGenerationProviderId) REFERENCES ai_provider_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (activeEmbeddingProviderId) REFERENCES ai_provider_configs(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS job_queue (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    dedupeKey TEXT,
    payloadJson TEXT NOT NULL,
    availableAt INTEGER NOT NULL,
    leaseOwner TEXT,
    leaseUntil INTEGER,
    attempt INTEGER NOT NULL CHECK (attempt >= 0),
    maxAttempts INTEGER NOT NULL CHECK (maxAttempts > 0),
    priority INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    lastError TEXT,
    UNIQUE (type, dedupeKey)
  );

  CREATE INDEX IF NOT EXISTS idx_job_queue_leaseable
    ON job_queue(availableAt ASC, leaseUntil ASC, priority DESC, createdAt ASC);

  CREATE INDEX IF NOT EXISTS idx_job_queue_type_created
    ON job_queue(type ASC, createdAt ASC);

  CREATE TABLE IF NOT EXISTS job_queue_dead_letters (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    dedupeKey TEXT,
    payloadJson TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    maxAttempts INTEGER NOT NULL,
    lastError TEXT NOT NULL,
    failedAt INTEGER NOT NULL,
    createdAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS indexing_strategy_settings (
    scopeType TEXT NOT NULL CHECK (scopeType IN ('global', 'user', 'project', 'document')),
    scopeId TEXT NOT NULL,
    strategyType TEXT NOT NULL CHECK (strategyType IN ('whole_document', 'sliding_window')),
    strategyProperties TEXT NOT NULL,
    updatedAt INTEGER NOT NULL,
    PRIMARY KEY (scopeType, scopeId)
  );

  CREATE TABLE IF NOT EXISTS document_embeddings (
    vectorKey TEXT PRIMARY KEY,
    documentId TEXT NOT NULL,
    providerConfigId TEXT,
    providerId TEXT NOT NULL,
    type TEXT NOT NULL,
    baseUrl TEXT NOT NULL,
    model TEXT NOT NULL,
    strategyType TEXT NOT NULL CHECK (strategyType IN ('whole_document', 'sliding_window')),
    strategyProperties TEXT NOT NULL,
    chunkOrdinal INTEGER NOT NULL CHECK (chunkOrdinal >= 0),
    chunkStart INTEGER NOT NULL CHECK (chunkStart >= 0),
    chunkEnd INTEGER NOT NULL CHECK (chunkEnd >= chunkStart),
    selectionFrom INTEGER,
    selectionTo INTEGER,
    chunkText TEXT NOT NULL,
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    documentTimestamp INTEGER NOT NULL,
    contentHash TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE,
    UNIQUE(documentId, baseUrl, model, chunkOrdinal)
  );

  CREATE INDEX IF NOT EXISTS idx_document_embeddings_search
    ON document_embeddings(baseUrl ASC, model ASC, dimensions ASC, documentId ASC, documentTimestamp ASC);

  CREATE INDEX IF NOT EXISTS idx_document_embeddings_document
    ON document_embeddings(documentId ASC);

  CREATE TABLE IF NOT EXISTS document_embedding_vector_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vectorKey TEXT NOT NULL UNIQUE,
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    FOREIGN KEY (vectorKey) REFERENCES document_embeddings(vectorKey) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_document_embedding_vector_rows_dimensions
    ON document_embedding_vector_rows(dimensions ASC);

  CREATE TABLE IF NOT EXISTS app_config_values (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updatedAt INTEGER NOT NULL CHECK (updatedAt > 0)
  );

  CREATE TABLE IF NOT EXISTS auth_users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    lastLoginAt INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email);

  CREATE TABLE IF NOT EXISTS auth_invitations (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    email TEXT,
    role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
    createdByUserId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL,
    revokedAt INTEGER,
    usedAt INTEGER,
    usedByUserId TEXT,
    FOREIGN KEY (createdByUserId) REFERENCES auth_users(id) ON DELETE RESTRICT,
    FOREIGN KEY (usedByUserId) REFERENCES auth_users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_auth_invitations_token ON auth_invitations(token);
  CREATE INDEX IF NOT EXISTS idx_auth_invitations_created_at ON auth_invitations(createdAt DESC);

  CREATE TABLE IF NOT EXISTS auth_sessions (
    token TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL,
    FOREIGN KEY (userId) REFERENCES auth_users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(userId);
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expiresAt);
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
    return this.#runWithPrimaryRecovery((db) => {
      const stmt = db.query(sql)
      return stmt.get(...(params as Parameters<typeof stmt.get>)) as T | undefined
    })
  }

  all<T>(sql: string, params: unknown[]): T[] {
    return this.#runWithPrimaryRecovery((db) => {
      const stmt = db.query(sql)
      return stmt.all(...(params as Parameters<typeof stmt.all>)) as T[]
    })
  }

  run(sql: string, params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    return this.#runWithPrimaryRecovery((db) => {
      const stmt = db.query(sql)
      const result = stmt.run(...(params as Parameters<typeof stmt.run>))
      return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
    })
  }

  exec(sql: string): void {
    this.#runWithPrimaryRecovery((db) => {
      db.exec(sql)
    })
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
    // WAL mode is persisted at the database level and configured on startup.
    // Re-running schema/pragma setup for each transient connection adds avoidable
    // churn and can race with native import workloads opening their own handles.
    this.#configureDatabase(isolated, { enableWal: false })
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

  /**
   * SQLite/Bun-specific maintenance hook.
   *
   * Some native paths (NAPI/sqlx) can write through a separate SQLite stack.
   * Refreshing the Bun primary handle keeps repository reads/writes coherent
   * after those external commits.
   */
  refreshPrimaryConnection(): void {
    this.#reopenPrimaryDatabase()
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
    sqliteVec.load(db)
  }

  #runWithPrimaryRecovery<T>(operation: (db: Database) => T): T {
    const activeDb = this.#getActiveDb()
    try {
      return operation(activeDb)
    } catch (error) {
      if (activeDb !== this.#db || !this.#isRecoverablePrimaryError(error)) {
        throw error
      }

      // Recovery is intentionally scoped to the SQLite primary handle.
      // Higher-level ports remain database-agnostic.
      this.#reopenPrimaryDatabase()
      return operation(this.#db)
    }
  }

  #reopenPrimaryDatabase(): void {
    if (this.#dbPath === ':memory:') return

    try {
      this.#db.close()
    } catch {
      void 0
    }

    this.#db = new Database(this.#dbPath)
    this.#configureDatabase(this.#db, { enableWal: true })
    this.#db.exec(SCHEMA)
  }

  #isRecoverablePrimaryError(error: unknown): boolean {
    const maybe = error as { code?: string; message?: string }
    const code = maybe?.code ?? ''
    const message = maybe?.message ?? ''

    if (
      code === 'SQLITE_NOTADB' ||
      code === 'SQLITE_IOERR_SHORT_READ' ||
      code === 'SQLITE_CANTOPEN'
    ) {
      return true
    }

    if (/file is not a database/i.test(message)) {
      return true
    }

    const coreTableMissingPattern =
      /no such table:\s*(projects|documents|project_documents|yjs_documents|version_snapshots|job_queue|document_embeddings|document_embedding_vector_rows)/i
    return coreTableMissingPattern.test(message)
  }
}

export function createConnection(dbPath: string): SqliteConnection {
  return new SqliteConnection(dbPath)
}
