import type { DragData, DropData } from './types'

export function toDragId(data: DragData): string {
  return data.kind === 'document' ? `drag:document:${data.id}` : `drag:directory:${data.path}`
}

export function toDirectoryDropId(path: string): string {
  return `drop:directory:${path}`
}

export function parseDropData(value: unknown): DropData | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<DropData>
  if (candidate.kind === 'root') return { kind: 'root' }
  if (candidate.kind === 'directory' && typeof candidate.path === 'string') {
    return { kind: 'directory', path: candidate.path }
  }
  return null
}
