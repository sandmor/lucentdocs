export const DIRECTORY_SENTINEL_NAME = '__dir__'

export function normalizeDocumentPath(input: string): string {
  return input
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('/')
}

export function pathSegments(path: string): string[] {
  const normalized = normalizeDocumentPath(path)
  return normalized ? normalized.split('/') : []
}

export function parentDocumentPath(path: string): string {
  const parts = pathSegments(path)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

export function pathHasSentinelSegment(path: string): boolean {
  return pathSegments(path).some((part) => part === DIRECTORY_SENTINEL_NAME)
}

export function isDirectorySentinelPath(path: string): boolean {
  const parts = pathSegments(path)
  return parts.length > 0 && parts.at(-1) === DIRECTORY_SENTINEL_NAME
}

export function directoryPathFromSentinel(path: string): string | null {
  if (!isDirectorySentinelPath(path)) return null
  const parts = pathSegments(path)
  return parts.slice(0, -1).join('/')
}

export function toDirectorySentinelPath(directoryPath: string): string {
  const normalized = normalizeDocumentPath(directoryPath)
  if (!normalized) {
    throw new Error('Directory path cannot be empty')
  }
  return `${normalized}/${DIRECTORY_SENTINEL_NAME}`
}

export function isPathInsideDirectory(path: string, directoryPath: string): boolean {
  const normalizedPath = normalizeDocumentPath(path)
  const normalizedDirectory = normalizeDocumentPath(directoryPath)

  if (!normalizedPath || !normalizedDirectory) return false
  if (normalizedPath === normalizedDirectory) return true
  return normalizedPath.startsWith(`${normalizedDirectory}/`)
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
  if (!isPathInsideDirectory(normalizedPath, normalizedSource)) return normalizedPath

  const suffix = normalizedPath.slice(normalizedSource.length + 1)
  return normalizedDestination ? `${normalizedDestination}/${suffix}` : suffix
}
