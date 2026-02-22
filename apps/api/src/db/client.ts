import sqlite3 from 'sqlite3'
import { open, Database } from 'sqlite'
import { mkdirSync } from 'fs'
import { AsyncLocalStorage } from 'node:async_hooks'
import { configManager } from '../config/manager.js'

let dbPromise: Promise<Database> | null = null
let initPromise: Promise<void> | null = null
const dbContext = new AsyncLocalStorage<Database>()

function resolveDataDir(): string {
  return configManager.getConfig().paths.dataDir
}

function resolveDbFile(): string {
  return configManager.getConfig().paths.dbFile
}

function ensureDataDir(): void {
  const dataDir = resolveDataDir()
  try {
    mkdirSync(dataDir, { recursive: true })
  } catch (error) {
    throw new Error(
      `Failed to create data directory at ${dataDir}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

async function openDbConnection(): Promise<Database> {
  ensureDataDir()

  const db = await open({
    filename: resolveDbFile(),
    driver: sqlite3.Database,
  })

  await db.exec('PRAGMA foreign_keys = ON')
  await db.exec('PRAGMA busy_timeout = 5000')

  return db
}

async function initializeDb(): Promise<Database> {
  const db = await openDbConnection()

  await db.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_version_snapshots_document ON version_snapshots(documentId)
  `)
  return db
}

export function getScopedDb(): Database | null {
  return dbContext.getStore() ?? null
}

export function runWithDbContext<T>(db: Database, fn: () => Promise<T>): Promise<T> {
  return dbContext.run(db, fn)
}

export async function openIsolatedDbConnection(): Promise<Database> {
  await getDb()
  return openDbConnection()
}

export async function getDb(): Promise<Database> {
  const scoped = dbContext.getStore()
  if (scoped) return scoped

  if (dbPromise) return dbPromise

  if (!initPromise) {
    initPromise = initializeDb().then((db) => {
      dbPromise = Promise.resolve(db)
    })
  }

  await initPromise
  return dbPromise!
}
