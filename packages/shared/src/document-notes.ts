import type { JsonObject } from './json.js'

export const NOTE_PLACEMENTS = ['before', 'after', 'about'] as const
export type NotePlacement = (typeof NOTE_PLACEMENTS)[number]

export interface DocumentNoteRecord {
  id: string
  documentId: string
  blockId: string
  placement: NotePlacement
  content: string
  authorUserId: string
  createdAt: number
  updatedAt: number
}

export interface DocumentNoteSnapshot {
  id: string
  blockId: string
  placement: NotePlacement
  content: JsonObject
  authorUserId: string
  createdAt: number
  updatedAt: number
}

export interface VersionSnapshotBundle {
  doc: JsonObject
  notes: DocumentNoteSnapshot[]
}

const DEFAULT_NOTE_BODY: JsonObject = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNotePlacement(value: unknown): value is NotePlacement {
  return typeof value === 'string' && NOTE_PLACEMENTS.includes(value as NotePlacement)
}

export function createDefaultNoteBody(): JsonObject {
  return structuredClone(DEFAULT_NOTE_BODY)
}

export function parseNoteBodyContent(content: string | null | undefined): JsonObject {
  if (!content) return createDefaultNoteBody()
  try {
    const parsed = JSON.parse(content) as unknown
    if (isRecord(parsed) && parsed.type === 'doc') {
      return parsed
    }
  } catch {
    // fall through
  }
  return createDefaultNoteBody()
}

export function serializeNoteBody(content: JsonObject): string {
  return JSON.stringify(content)
}

export function parseVersionSnapshotBundle(content: string | null | undefined): VersionSnapshotBundle {
  const strict = parseVersionSnapshotBundleStrict(content)
  if (strict) return strict
  return { doc: { type: 'doc', content: [{ type: 'paragraph' }] }, notes: [] }
}

export function parseVersionSnapshotBundleStrict(
  content: string | null | undefined
): VersionSnapshotBundle | null {
  if (!content) return null

  try {
    const parsed = JSON.parse(content) as unknown
    if (!isRecord(parsed)) return null

    if (isRecord(parsed.doc) && parsed.doc.type === 'doc') {
      return {
        doc: parsed.doc,
        notes: parseNoteSnapshots(parsed.notes),
      }
    }

    if (parsed.type === 'doc') {
      return { doc: parsed, notes: [] }
    }
  } catch {
    return null
  }

  return null
}

export function serializeVersionSnapshotBundle(bundle: VersionSnapshotBundle): string {
  return JSON.stringify(bundle)
}

function parseNoteSnapshots(value: unknown): DocumentNoteSnapshot[] {
  if (!Array.isArray(value)) return []

  const notes: DocumentNoteSnapshot[] = []
  for (const entry of value) {
    const parsed = parseNoteSnapshot(entry)
    if (parsed) notes.push(parsed)
  }
  return notes
}

function parseNoteSnapshot(value: unknown): DocumentNoteSnapshot | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || typeof value.blockId !== 'string') return null
  if (!isNotePlacement(value.placement)) return null
  if (!isRecord(value.content) || value.content.type !== 'doc') return null
  if (typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number') return null
  if (typeof value.authorUserId !== 'string' || value.authorUserId.length === 0) return null

  return {
    id: value.id,
    blockId: value.blockId,
    placement: value.placement,
    content: value.content,
    authorUserId: value.authorUserId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

export function noteRecordToSnapshot(record: DocumentNoteRecord): DocumentNoteSnapshot {
  return {
    id: record.id,
    blockId: record.blockId,
    placement: record.placement,
    content: parseNoteBodyContent(record.content),
    authorUserId: record.authorUserId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export function noteSnapshotToRecord(
  documentId: string,
  snapshot: DocumentNoteSnapshot
): DocumentNoteRecord {
  return {
    id: snapshot.id,
    documentId,
    blockId: snapshot.blockId,
    placement: snapshot.placement,
    content: serializeNoteBody(snapshot.content),
    authorUserId: snapshot.authorUserId,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  }
}
