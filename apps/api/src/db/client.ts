import sqlite3 from 'sqlite3'
import { open, Database } from 'sqlite'
import path from 'path'
import { resolveFromRoot } from '../paths.js'

let dbPromise: Promise<Database> | null = null

const DATA_DIR = resolveFromRoot(process.env.PLOTLINE_DATA_DIR || './data')

/**
 * Get or create a SQLite database connection.
 * Data is stored in the project directory by default.
 */
export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = open({
      filename: path.join(DATA_DIR, 'sqlite.db'),
      driver: sqlite3.Database,
    }).then(async (db) => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL
        )
      `)
      return db
    })
  }
  return dbPromise
}
