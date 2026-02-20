import * as lancedb from '@lancedb/lancedb'
import path from 'path'
import { resolveFromRoot } from '../paths.js'

let dbPromise: Promise<lancedb.Connection> | null = null

const DATA_DIR = resolveFromRoot(process.env.PLOTLINE_DATA_DIR || './data')

/**
 * Get or create a LanceDB connection.
 * Data is stored in the project root `data/` directory by default,
 * configurable via PLOTLINE_DATA_DIR environment variable.
 */
export async function getDb(): Promise<lancedb.Connection> {
  if (!dbPromise) {
    dbPromise = lancedb.connect(path.join(DATA_DIR, 'lancedb'))
  }
  return dbPromise
}
