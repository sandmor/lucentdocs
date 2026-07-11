export type SuggestedNextTool = 'read' | 'glob' | 'grep' | 'search'

export interface ToolResultMeta {
  truncated: boolean
  has_more?: boolean
  next_offset?: number | null
  char_truncated?: boolean
  semantic_unavailable?: boolean
  indexing_stale?: boolean
  whole_document_matches?: boolean
  suggested_next?: SuggestedNextTool
  summary?: string
}

export function buildPaginationMeta(options: {
  truncated: boolean
  hasMore: boolean
  nextOffset: number | null
  charTruncated?: boolean
  suggestedNext?: SuggestedNextTool
  summary?: string
}): ToolResultMeta {
  const meta: ToolResultMeta = {
    truncated: options.truncated,
    has_more: options.hasMore,
    next_offset: options.nextOffset,
    suggested_next: options.suggestedNext,
  }

  if (options.charTruncated) {
    meta.char_truncated = true
  }

  if (options.summary) {
    meta.summary = options.summary
  }

  return meta
}
