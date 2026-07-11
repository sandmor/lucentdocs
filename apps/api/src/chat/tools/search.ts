import { tool } from 'ai'
import { z } from 'zod/v4'
import {
  describeIndexingStrategy,
  normalizeDocumentPath,
  pathHasSentinelSegment,
  type ResolvedIndexingStrategy,
} from '@lucentdocs/shared'
import { configManager } from '../../config/runtime.js'
import type { ProjectDocumentSearchResult } from '../../core/services/documents.service.js'
import type { ServiceSet } from '../../core/services/types.js'
import {
  SEARCH_QUERY_EMPTY_ERROR,
  formatSemanticChunkSearchMatches,
  normalizeValidatedSearchText,
} from '../../core/services/documentSearch.js'
import { getToolLimits } from '../utils.js'
import { SEARCH_DESCRIPTION } from './descriptions/index.js'
import { extractAnnotationIdsFromMarkers } from '../../ai/annotation-context.js'
import type { LoadedDocumentText } from './document-text.js'
import { loadDocumentText } from './document-text.js'
import { logToolFailure, formatPathNotFound } from './errors.js'
import { distanceToRelevanceScore, selectionRangeToLineRange } from './line-coords.js'
import type { ToolResultMeta } from './meta.js'
import {
  loadProjectFileIndex,
  resolveDocumentPath,
  resolveNormalizedPath,
  suggestPaths,
} from './paths.js'
import type { BuildReadToolsContext } from './types.js'

type SearchToolConfig = {
  defaultResultLimit: number
  maxResultLimit: number
  snippetLimit: number
  previewMaxLength: number
}

type ObservedSemanticIndexing = {
  type: 'sliding_window' | 'whole_document' | 'mixed'
}

function getSearchToolConfig(): SearchToolConfig {
  const searchConfig = configManager.getConfig().search
  const toolLimits = getToolLimits()

  return {
    defaultResultLimit: Math.min(searchConfig.defaultLimit, toolLimits.MAX_TOOL_ENTRIES),
    maxResultLimit: Math.min(searchConfig.maxLimit, toolLimits.MAX_TOOL_ENTRIES),
    snippetLimit: searchConfig.snippetDefaultLimit,
    previewMaxLength: searchConfig.snippetMaxLength,
  }
}

function buildIndexingSummary(resolvedIndexing: ResolvedIndexingStrategy | null): null | {
  scope_type: string
  scope_id: string
  type: string
  description: string
} {
  if (!resolvedIndexing) return null

  return {
    scope_type: resolvedIndexing.scopeType,
    scope_id: resolvedIndexing.scopeId,
    type: resolvedIndexing.strategy.type,
    description: describeIndexingStrategy(resolvedIndexing.strategy),
  }
}

async function buildIndexingSummaries(
  services: ServiceSet,
  projectId: string,
  documentIds: string[]
): Promise<
  Map<string, null | { scope_type: string; scope_id: string; type: string; description: string }>
> {
  const resolvedByDocumentId = await services.indexingSettings.resolveForProjectDocuments(
    projectId,
    documentIds
  )
  const summaries = new Map<
    string,
    null | { scope_type: string; scope_id: string; type: string; description: string }
  >()

  for (const documentId of documentIds) {
    const resolved = resolvedByDocumentId.get(documentId) ?? null
    summaries.set(documentId, buildIndexingSummary(resolved))
  }

  return summaries
}

function summarizeObservedIndexingFromMatches(
  matches: Array<{ strategyType: 'sliding_window' | 'whole_document' }>
): ObservedSemanticIndexing | null {
  if (matches.length === 0) return null

  const observedTypes = new Set(matches.map((match) => match.strategyType))
  if (observedTypes.size === 1) {
    const onlyType = observedTypes.values().next().value
    if (!onlyType) return null
    return { type: onlyType }
  }

  return { type: 'mixed' }
}

export function createSearchTool(context: BuildReadToolsContext) {
  const searchToolConfig = getSearchToolConfig()

  return tool({
    description: SEARCH_DESCRIPTION,
    inputSchema: z.object({
      query: z
        .string()
        .describe('Natural-language or descriptive phrase for semantic search (not exact substring matching).'),
      path: z
        .string()
        .optional()
        .describe(
          'Optional file or directory path (project-relative, no leading slash). Omit to search the active file unless whole_project is true.'
        ),
      whole_project: z
        .boolean()
        .optional()
        .describe('When true, search across the entire project instead of the active file.'),
      recursive: z
        .boolean()
        .optional()
        .describe('When path is a directory, search the subtree recursively (default false = direct children only).'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(searchToolConfig.maxResultLimit)
        .optional(),
    }),
    execute: async ({ query, path, whole_project = false, recursive = false, limit }) => {
      const normalizedQuery = normalizeValidatedSearchText(
        query,
        configManager.getConfig().search.maxQueryChars
      )
      if (!normalizedQuery) {
        throw new Error(SEARCH_QUERY_EMPTY_ERROR)
      }

      const resultLimit = Math.min(
        limit ?? searchToolConfig.defaultResultLimit,
        searchToolConfig.maxResultLimit
      )

      const index = await loadProjectFileIndex(context.scope.projectId, context.services)
      const hasExplicitPath = path !== undefined
      const scopedPath = hasExplicitPath ? resolveNormalizedPath(path) : ''

      if (!hasExplicitPath && !whole_project) {
        const activePath = resolveDocumentPath(index, context.scope.documentId)
        if (!activePath) {
          throw new Error('The active file is no longer available in this project.')
        }

        const meta: ToolResultMeta = {
          truncated: false,
          semantic_unavailable: false,
          indexing_stale: false,
          whole_document_matches: false,
          suggested_next: 'read',
        }

        return searchSingleDocument(
          context,
          context.scope.documentId,
          activePath,
          normalizedQuery,
          resultLimit,
          meta
        )
      }

      if (scopedPath && !index.files.has(scopedPath) && !index.directories.has(scopedPath)) {
        throw formatPathNotFound(path ?? scopedPath, suggestPaths(path ?? scopedPath, index))
      }

      if (scopedPath && pathHasSentinelSegment(scopedPath)) {
        throw new Error('Search path contains a reserved segment.')
      }

      const meta: ToolResultMeta = {
        truncated: false,
        semantic_unavailable: false,
        indexing_stale: false,
        whole_document_matches: false,
        suggested_next: 'read',
      }

      if (scopedPath && index.files.has(scopedPath)) {
        const documentId = index.files.get(scopedPath)
        if (!documentId) {
          throw new Error(`File "${scopedPath}" is no longer available in this project.`)
        }

        return searchSingleDocument(context, documentId, scopedPath, normalizedQuery, resultLimit, meta)
      }

      let searchScope:
        | { type: 'project' }
        | { type: 'directory'; directoryPath: string }
        | { type: 'directory_subtree'; directoryPath: string } = { type: 'project' }

      if (scopedPath && index.directories.has(scopedPath)) {
        searchScope = recursive
          ? { type: 'directory_subtree', directoryPath: scopedPath }
          : { type: 'directory', directoryPath: scopedPath }
      }

      if (searchScope.type === 'directory_subtree' && scopedPath === '') {
        searchScope = { type: 'project' }
      }

      let semanticResults: ProjectDocumentSearchResult[] = []
      try {
        semanticResults = await context.services.documents.searchForProject(
          context.scope.projectId,
          normalizedQuery,
          searchScope,
          { limit: resultLimit, maxSnippetsPerDocument: searchToolConfig.snippetLimit }
        )
      } catch (error) {
        logToolFailure('search', 'Semantic search was unavailable for this project search.', error)
        meta.semantic_unavailable = true
        meta.suggested_next = 'grep'
        meta.summary = 'Semantic search was unavailable. Try grep for exact text matching.'
        return {
          query: normalizedQuery,
          path: scopedPath || undefined,
          matches: [],
          match_count: 0,
          meta,
        }
      }

      const limitedResults = semanticResults.slice(0, resultLimit)
      meta.truncated = semanticResults.length > resultLimit
      const indexingByDocumentId = await buildIndexingSummaries(
        context.services,
        context.scope.projectId,
        limitedResults.map((result) => result.id)
      )

      const loadedTextByDocumentId = new Map<string, LoadedDocumentText>()
      const matches = []
      for (const result of limitedResults) {
        const documentPath = normalizeDocumentPath(result.title) || '(untitled)'
        const document = await context.services.documents.getForProject(
          context.scope.projectId,
          result.id
        )
        const loadedText = document
          ? await getCachedLoadedDocumentText(
              context,
              loadedTextByDocumentId,
              result.id,
              documentPath
            )
          : null
        const indexing = indexingByDocumentId.get(result.id) ?? null
        const observedType =
          result.matchType === 'whole_document' ? 'whole_document' : 'sliding_window'

        if (indexing?.type && indexing.type !== observedType) {
          meta.indexing_stale = true
        }
        if (observedType === 'whole_document') {
          meta.whole_document_matches = true
        }

        if (result.matchType === 'whole_document' || result.snippets.length === 0) {
          matches.push({
            path: documentPath,
            start_line: null,
            end_line: null,
            relevance_score: distanceToRelevanceScore(result.score),
            preview: result.snippets[0]?.text ?? '',
            match_type: result.matchType,
            annotation_ids: [] as string[],
          })
          continue
        }

        for (const snippet of result.snippets) {
          const lineRange =
            document && loadedText
              ? selectionRangeToLineRange(
                  document.content,
                  snippet.selectionFrom,
                  snippet.selectionTo,
                  loadedText.content
                )
              : null

          const annotationIds =
            loadedText && lineRange
              ? annotationIdsInRenderedSlice(loadedText, lineRange)
              : []

          matches.push({
            path: documentPath,
            start_line: lineRange?.start_line ?? null,
            end_line: lineRange?.end_line ?? null,
            relevance_score: distanceToRelevanceScore(snippet.score),
            preview: snippet.text,
            match_type: result.matchType,
            annotation_ids: annotationIds,
          })
        }
      }

      if (meta.whole_document_matches) {
        meta.summary =
          'Some matches use whole-document indexing and may lack precise line locations. Use read to inspect full files.'
      }

      return {
        query: normalizedQuery,
        path: scopedPath || undefined,
        matches,
        match_count: matches.length,
        meta,
      }
    },
  })
}

async function searchSingleDocument(
  context: BuildReadToolsContext,
  documentId: string,
  path: string,
  normalizedQuery: string,
  resultLimit: number,
  meta: ToolResultMeta
) {
  const resolved = await context.services.indexingSettings.resolveForDocument(
    documentId,
    context.scope.projectId
  )
  const indexing = buildIndexingSummary(resolved)
  if (indexing?.type === 'whole_document') {
    meta.whole_document_matches = true
    meta.summary =
      'This document uses whole-document indexing; semantic search may confirm relevance without a precise line.'
  }

  let semanticMatches = []
  let observedMatchIndexing: ObservedSemanticIndexing | null = null

  try {
    const semanticResults = await context.services.documents.searchForProjectDocument(
      context.scope.projectId,
      documentId,
      normalizedQuery,
      { limit: resultLimit }
    )
    observedMatchIndexing = summarizeObservedIndexingFromMatches(semanticResults)
    semanticMatches = formatSemanticChunkSearchMatches(semanticResults, normalizedQuery, {
      limit: resultLimit,
      maxPreviewLength: getSearchToolConfig().previewMaxLength,
    })
  } catch (error) {
    logToolFailure('search', 'Semantic search was unavailable for this file.', error)
    meta.semantic_unavailable = true
    meta.suggested_next = 'grep'
    meta.summary = 'Semantic search was unavailable. Try grep for exact text matching.'
    return {
      query: normalizedQuery,
      path,
      matches: [],
      match_count: 0,
      meta,
    }
  }

  if (
    indexing?.type &&
    observedMatchIndexing?.type &&
    observedMatchIndexing.type !== 'mixed' &&
    indexing.type !== observedMatchIndexing.type
  ) {
    meta.indexing_stale = true
    meta.summary = 'Configured indexing differs from observed embeddings; results may be stale.'
  }

  const document = await context.services.documents.getForProject(context.scope.projectId, documentId)
  const loadedText = document
    ? await loadDocumentText(
        context.services,
        context.scope.projectId,
        documentId,
        path,
        { includeAnnotations: true }
      )
    : null
  const matches = []

  for (const match of semanticMatches) {
    const lineRange =
      document && loadedText
        ? selectionRangeToLineRange(
            document.content,
            match.selectionFrom,
            match.selectionTo,
            loadedText.content
          )
        : null

    const annotationIds =
      loadedText && lineRange ? annotationIdsInRenderedSlice(loadedText, lineRange) : []

    matches.push({
      path,
      start_line: lineRange?.start_line ?? null,
      end_line: lineRange?.end_line ?? null,
      relevance_score: distanceToRelevanceScore(match.score),
      preview: match.preview,
      match_type: match.matchType,
      annotation_ids: annotationIds,
    })
  }

  return {
    query: normalizedQuery,
    path,
    matches,
    match_count: matches.length,
    meta,
  }
}

async function getCachedLoadedDocumentText(
  context: BuildReadToolsContext,
  cache: Map<string, LoadedDocumentText>,
  documentId: string,
  path: string
): Promise<LoadedDocumentText | null> {
  const existing = cache.get(documentId)
  if (existing) return existing

  const loaded = await loadDocumentText(
    context.services,
    context.scope.projectId,
    documentId,
    path,
    { includeAnnotations: true }
  )
  if (loaded) {
    cache.set(documentId, loaded)
  }
  return loaded
}

function annotationIdsInRenderedSlice(
  loadedText: LoadedDocumentText,
  lineRange: { start_line: number; end_line: number }
): string[] {
  const lines = loadedText.content.split('\n')
  const slice = lines.slice(lineRange.start_line - 1, lineRange.end_line).join('\n')
  return [...extractAnnotationIdsFromMarkers(slice)]
}
