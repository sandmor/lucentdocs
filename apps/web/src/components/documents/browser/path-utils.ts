import {
  directoryPathFromSentinel,
  isDirectorySentinelPath,
  normalizeDocumentPath,
  pathSegments,
} from '@lucentdocs/shared'
import type { BrowserRow, DocumentItem } from './types'

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function basename(path: string): string {
  const parts = pathSegments(path)
  return parts.at(-1) ?? ''
}

export function parentPath(path: string): string {
  const parts = pathSegments(path)
  return parts.slice(0, -1).join('/')
}

export function normalizeDestination(input: string): string {
  return normalizeDocumentPath(input)
}

export function remapPathInsideDirectory(
  path: string,
  sourceDirectory: string,
  destinationDirectory: string
): string {
  const normalizedPath = normalizeDocumentPath(path)
  const normalizedSource = normalizeDocumentPath(sourceDirectory)
  const normalizedDestination = normalizeDocumentPath(destinationDirectory)

  if (!normalizedPath || !normalizedSource) return normalizedPath
  if (normalizedPath === normalizedSource) return normalizedDestination
  if (normalizedPath.startsWith(`${normalizedSource}/`)) {
    const suffix = normalizedPath.slice(normalizedSource.length + 1)
    return normalizedDestination ? `${normalizedDestination}/${suffix}` : suffix
  }

  return normalizedPath
}

function toVisibleChildDirectory(currentPath: string, targetPath: string): string | null {
  const normalizedCurrent = normalizeDocumentPath(currentPath)
  const normalizedTarget = normalizeDocumentPath(targetPath)
  if (!normalizedTarget) return null

  if (normalizedCurrent) {
    if (normalizedTarget === normalizedCurrent) return null
    if (!normalizedTarget.startsWith(`${normalizedCurrent}/`)) return null

    const remainder = normalizedTarget.slice(normalizedCurrent.length + 1)
    const [child] = remainder.split('/')
    if (!child) return null
    return `${normalizedCurrent}/${child}`
  }

  const [child] = normalizedTarget.split('/')
  return child || null
}

export function buildRows(allDocuments: DocumentItem[], currentPath: string): BrowserRow[] {
  const normalizedCurrent = normalizeDocumentPath(currentPath)
  const directoryRows = new Map<string, BrowserRow>()
  const files: BrowserRow[] = []

  const upsertDirectory = (directoryPath: string, createdAt: number, updatedAt: number) => {
    const normalizedPath = normalizeDocumentPath(directoryPath)
    if (!normalizedPath) return

    const childDirectoryPath = toVisibleChildDirectory(normalizedCurrent, normalizedPath)
    if (!childDirectoryPath) return

    const existing = directoryRows.get(childDirectoryPath)
    const name = basename(childDirectoryPath)
    if (!name) return

    if (!existing) {
      directoryRows.set(childDirectoryPath, {
        key: `dir:${childDirectoryPath}`,
        type: 'directory',
        name,
        path: childDirectoryPath,
        createdAt,
        updatedAt,
      })
      return
    }

    existing.createdAt = Math.min(existing.createdAt, createdAt)
    existing.updatedAt = Math.max(existing.updatedAt, updatedAt)
  }

  for (const doc of allDocuments) {
    const normalizedTitle = normalizeDocumentPath(doc.title)
    if (!normalizedTitle) continue

    if (isDirectorySentinelPath(normalizedTitle)) {
      const sentinelDirectory = directoryPathFromSentinel(normalizedTitle)
      if (sentinelDirectory) {
        upsertDirectory(sentinelDirectory, doc.createdAt, doc.updatedAt)
      }
      continue
    }

    const prefix = normalizedCurrent ? `${normalizedCurrent}/` : ''
    if (prefix && !normalizedTitle.startsWith(prefix)) continue

    const remainder = prefix ? normalizedTitle.slice(prefix.length) : normalizedTitle
    const [head, ...rest] = remainder.split('/')
    if (!head) continue

    if (rest.length > 0) {
      const directoryPath = normalizedCurrent ? `${normalizedCurrent}/${head}` : head
      upsertDirectory(directoryPath, doc.createdAt, doc.updatedAt)
      continue
    }

    files.push({
      key: `doc:${doc.id}`,
      type: 'document',
      id: doc.id,
      name: head,
      path: normalizedTitle,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    })
  }

  const sortByName = (a: BrowserRow, b: BrowserRow) => a.name.localeCompare(b.name)
  return [...directoryRows.values()].sort(sortByName).concat(files.sort(sortByName))
}
