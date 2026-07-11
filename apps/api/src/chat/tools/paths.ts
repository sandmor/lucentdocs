import type { ProjectFileIndex } from '../utils.js'
import { buildProjectFileIndex, normalizeProjectPath } from '../utils.js'
import type { ServiceSet } from '../../core/services/types.js'
import { MAX_PATH_SUGGESTIONS } from './types.js'

export async function loadProjectFileIndex(
  projectId: string,
  services: ServiceSet
): Promise<ProjectFileIndex> {
  return buildProjectFileIndex(
    projectId,
    services.documents.listForProject.bind(services.documents)
  )
}

export function resolveNormalizedPath(rawPath: string): string {
  return normalizeProjectPath(rawPath)
}

export function resolveDocumentPath(
  index: ProjectFileIndex,
  documentId: string
): string | null {
  for (const [path, id] of index.files) {
    if (id === documentId) return path
  }
  return null
}

export function suggestPaths(
  query: string,
  index: ProjectFileIndex,
  limit = MAX_PATH_SUGGESTIONS
): string[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return []

  const candidates = new Set<string>()
  for (const filePath of index.files.keys()) candidates.add(filePath)
  for (const directoryPath of index.directories) {
    if (directoryPath.length > 0) candidates.add(directoryPath)
  }

  const scored: Array<{ path: string; score: number }> = []
  for (const candidate of candidates) {
    const lowerCandidate = candidate.toLowerCase()
    const baseName = candidate.split('/').pop() ?? candidate

    if (lowerCandidate === normalizedQuery) {
      scored.push({ path: candidate, score: 100 })
      continue
    }

    if (lowerCandidate.includes(normalizedQuery) || normalizedQuery.includes(lowerCandidate)) {
      scored.push({ path: candidate, score: 60 })
      continue
    }

    if (baseName.toLowerCase().includes(normalizedQuery)) {
      scored.push({ path: candidate, score: 40 })
    }
  }

  return scored
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, limit)
    .map((entry) => entry.path)
}

export function listDirectoryEntries(
  index: ProjectFileIndex,
  directoryPath: string
): Array<{ type: 'file' | 'directory'; path: string }> {
  const directoryEntries = [...index.directories]
    .filter((entry) => entry.length > 0)
    .filter((entry) => {
      const parent = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/')) : ''
      return parent === directoryPath
    })
    .map((entry) => ({ type: 'directory' as const, path: entry }))

  const fileEntries = [...index.files.keys()]
    .filter((entry) => {
      const parent = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/')) : ''
      return parent === directoryPath
    })
    .map((entry) => ({ type: 'file' as const, path: entry }))

  return [...directoryEntries, ...fileEntries].sort((left, right) =>
    left.path.localeCompare(right.path)
  )
}

export function pathsMatchingPrefix(paths: readonly string[], prefix: string): string[] {
  if (!prefix) return [...paths]
  return paths.filter(
    (entry) => entry === prefix || entry.startsWith(`${prefix}/`)
  )
}
