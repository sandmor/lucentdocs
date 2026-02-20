import path from 'path'
import { fileURLToPath } from 'url'

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url))

// Project root is 3 levels up from this file (apps/api/src/)
export const PROJECT_ROOT = path.join(SRC_DIR, '../../..')

/**
 * Resolve a path relative to the project root.
 * If the path is absolute, returns it unchanged.
 */
export function resolveFromRoot(relativePath: string): string {
  return path.isAbsolute(relativePath) ? relativePath : path.join(PROJECT_ROOT, relativePath)
}
