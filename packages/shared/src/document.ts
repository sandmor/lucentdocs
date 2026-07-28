import type { JsonObject } from './json.js'

export interface Document {
  id: string
  /** Stable label derived from the document's home-project mount. */
  title: string
  /** The required project that owns this document's lifecycle. */
  homeProjectId: string
  type: string
  metadata: JsonObject | null
  createdAt: number
  updatedAt: number
}

export const DOCUMENT_ACCESS_ROLES = ['viewer', 'editor'] as const
export type DocumentAccessRole = (typeof DOCUMENT_ACCESS_ROLES)[number]

export interface ProjectDocumentMount {
  projectId: string
  documentId: string
  /** Project-local file path; it is intentionally not the canonical document title. */
  path: string
  addedByUserId: string
  addedAt: number
  updatedAt: number
}

export interface ProjectDocument extends Document, ProjectDocumentMount {}
