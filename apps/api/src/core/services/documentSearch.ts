/**
 * Shared document-search helpers used by both user-facing search APIs and AI tools.
 *
 * The goal of this module is to keep search normalization, snippet construction,
 * overlap deduplication, and snippet formatting in one place so service and tool
 * layers can stay thin and consistent.
 */

export interface SemanticChunkSearchMatchInput {
  strategyType: 'whole_document' | 'sliding_window'
  chunkOrdinal: number
  selectionFrom: number | null
  selectionTo: number | null
  chunkText: string
  score: number
}

export const SEARCH_QUERY_EMPTY_ERROR = 'Search query must not be empty.'

export function buildSearchQueryTooLongError(maxChars: number): string {
  return `Search query exceeds maximum length of ${maxChars} characters.`
}

export interface SemanticChunkSearchPreview {
  matchType: 'snippet' | 'whole_document'
  chunkOrdinal: number
  selectionFrom: number | null
  selectionTo: number | null
  score: number
  preview: string
}

export function normalizeSearchText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizeValidatedSearchText(value: string, maxChars: number): string {
  const normalized = normalizeSearchText(value)
  if (!normalized) return ''
  if (normalized.length > maxChars) {
    throw new Error(buildSearchQueryTooLongError(maxChars))
  }
  return normalized
}

export function buildSearchTerms(query: string): string[] {
  return Array.from(
    new Set(
      normalizeSearchText(query)
        .toLowerCase()
        .split(' ')
        .map((term) => term.trim())
        .filter((term) => term.length >= 2)
    )
  )
}

/**
 * Builds a human-readable snippet preview anchored around the first matching term.
 */
export function buildSnippetPreview(
  text: string,
  query: string,
  options: { maxLength?: number; anchorPadding?: number } = {}
): string {
  const normalizedText = normalizeSearchText(text)
  if (!normalizedText) return ''

  const maxLength = options.maxLength ?? 280
  if (normalizedText.length <= maxLength) {
    return normalizedText
  }

  const loweredText = normalizedText.toLowerCase()
  const loweredQuery = normalizeSearchText(query).toLowerCase()
  const anchorPadding = options.anchorPadding ?? 56
  const anchor = buildSearchTerms(query)
    .map((term) => loweredText.indexOf(term))
    .concat(loweredQuery ? [loweredText.indexOf(loweredQuery)] : [])
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0]

  const preferredStart = anchor === undefined ? 0 : Math.max(0, anchor - anchorPadding)
  const start = Math.min(preferredStart, Math.max(0, normalizedText.length - maxLength))
  const end = Math.min(normalizedText.length, start + maxLength)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < normalizedText.length ? '...' : ''
  return `${prefix}${normalizedText.slice(start, end).trim()}${suffix}`
}

/**
 * Determines whether two ranges overlap significantly enough to count as the
 * same visible match in search results.
 */
export function rangesSubstantiallyOverlap(
  left: { start: number; end: number },
  right: { start: number; end: number }
): boolean {
  const overlapStart = Math.max(left.start, right.start)
  const overlapEnd = Math.min(left.end, right.end)
  if (overlapEnd <= overlapStart) return false

  const overlap = overlapEnd - overlapStart
  const leftLength = Math.max(1, left.end - left.start)
  const rightLength = Math.max(1, right.end - right.start)
  return overlap / Math.min(leftLength, rightLength) >= 0.6
}

/**
 * Normalizes semantic chunk matches into a UI/tool-friendly shape and removes
 * redundant overlapping snippet results.
 */
export function formatSemanticChunkSearchMatches(
  matches: SemanticChunkSearchMatchInput[],
  query: string,
  options: { limit: number; maxPreviewLength?: number }
): SemanticChunkSearchPreview[] {
  const results: SemanticChunkSearchPreview[] = []
  const maxPreviewLength = options.maxPreviewLength ?? 280

  for (const match of matches) {
    const nextMatch: SemanticChunkSearchPreview = {
      matchType: match.strategyType === 'whole_document' ? 'whole_document' : 'snippet',
      chunkOrdinal: match.chunkOrdinal,
      selectionFrom: match.selectionFrom,
      selectionTo: match.selectionTo,
      score: match.score,
      preview: buildSnippetPreview(match.chunkText, query, { maxLength: maxPreviewLength }),
    }

    if (nextMatch.matchType === 'whole_document') {
      if (results.some((existing) => existing.matchType === 'whole_document')) {
        continue
      }
      results.push(nextMatch)
    } else {
      const nextRange =
        nextMatch.selectionFrom === null || nextMatch.selectionTo === null
          ? null
          : {
              start: nextMatch.selectionFrom,
              end: nextMatch.selectionTo,
            }

      if (
        nextRange &&
        results.some((existing) => {
          if (
            existing.matchType !== 'snippet' ||
            existing.selectionFrom === null ||
            existing.selectionTo === null
          ) {
            return false
          }

          return rangesSubstantiallyOverlap(nextRange, {
            start: existing.selectionFrom,
            end: existing.selectionTo,
          })
        })
      ) {
        continue
      }

      results.push(nextMatch)
    }

    if (results.length >= options.limit) break
  }

  return results
}
