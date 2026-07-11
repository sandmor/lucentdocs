import type { ServiceSet } from '../../core/services/types.js'

export interface ToolScope {
  projectId: string
  documentId: string
}

export interface BuildReadToolsContext {
  scope: ToolScope
  services: ServiceSet
}

export const DEFAULT_READ_LINE_LIMIT = 2000
export const DEFAULT_GREP_MATCH_LIMIT = 100
export const MAX_PATH_SUGGESTIONS = 3
