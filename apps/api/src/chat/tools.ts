import { tool } from 'ai'
import { z } from 'zod/v4'
import {
  describeIndexingStrategy,
  isPathInsideDirectory,
  normalizeDocumentPath,
  parentDocumentPath,
  inlineZoneChoicesToolInputSchema,
  inlineZoneWriteToolInputSchema,
  normalizeInlineZoneChoices,
  type InlineZoneWriteAction,
  type InlineZoneReplaceAction,
  type InlineZoneChoicesAction,
  type ResolvedIndexingStrategy,
} from '@lucentdocs/shared'
import { configManager } from '../config/runtime.js'
import type { ServiceSet } from '../core/services/types.js'
import type { ProjectDocumentSearchResult } from '../core/services/documents.service.js'
import { renderDocumentContentToMarkdown } from '../core/services/documentContent.js'
import {
  SEARCH_QUERY_EMPTY_ERROR,
  formatSemanticChunkSearchMatches,
  normalizeValidatedSearchText,
  type SemanticChunkSearchPreview,
} from '../core/services/documentSearch.js'
import { buildProjectFileIndex, getToolLimits, normalizeProjectPath } from './utils.js'

export interface ToolScope {
  projectId: string
  documentId: string
}

interface BuildInlineToolsOptions {
  onWriteAction: (action: InlineZoneWriteAction) => void | Promise<void>
}

type BuildReadToolsContext = {
  scope: ToolScope
  services: ServiceSet
}

type SearchToolConfig = {
  defaultResultLimit: number
  maxResultLimit: number
  snippetLimit: number
  previewMaxLength: number
}

type ObservedSemanticIndexing = {
  type: 'sliding_window' | 'whole_document' | 'mixed'
  source: 'semantic_matches'
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

function noteToolFailure(notes: string[], toolName: string, context: string, error: unknown): void {
  const includeErrorDetails = process.env.LUCENTDOCS_DEBUG_TOOL_ERRORS === '1'
  const errorSummary =
    error instanceof Error
      ? `${error.name}${error.message ? `: ${error.message}` : ''}`
      : 'unknown error'

  if (includeErrorDetails) {
    console.warn(`[${toolName}] ${context}`, error)
  } else {
    console.warn(`[${toolName}] ${context} (${errorSummary})`)
  }

  notes.push(`${context} Please retry, or check server logs for details.`)
}

function summarizeObservedIndexingFromMatches(
  matches: Array<{ strategyType: 'sliding_window' | 'whole_document' }>
): ObservedSemanticIndexing | null {
  if (matches.length === 0) return null

  const observedTypes = new Set(matches.map((match) => match.strategyType))
  if (observedTypes.size === 1) {
    const onlyType = observedTypes.values().next().value
    if (!onlyType) return null
    return {
      type: onlyType,
      source: 'semantic_matches',
    }
  }

  return {
    type: 'mixed',
    source: 'semantic_matches',
  }
}

export function buildReadTools({ scope, services }: BuildReadToolsContext) {
  const searchToolConfig = getSearchToolConfig()

  return {
    list_files: tool({
      description:
        'List project files and directories from the project document tree. Use this to discover structure.',
      inputSchema: z.object({
        path: z.string().describe('Directory path to inspect. Use "/" for project root.'),
        recursive: z
          .boolean()
          .optional()
          .describe('Whether to include nested descendants recursively.'),
      }),
      execute: async ({ path, recursive = false }) => {
        const index = await buildProjectFileIndex(
          scope.projectId,
          services.documents.listForProject.bind(services.documents)
        )
        const normalizedPath = normalizeProjectPath(path)

        if (normalizedPath && index.files.has(normalizedPath)) {
          throw new Error(`Path "${path}" is a file. Use read_file to inspect file contents.`)
        }

        if (normalizedPath && !index.directories.has(normalizedPath)) {
          throw new Error(`Directory "${path}" was not found in this project.`)
        }

        const matchesRecursivePath = (entryPath: string) => {
          if (!recursive) {
            return parentDocumentPath(entryPath) === normalizedPath
          }

          if (!normalizedPath) {
            return entryPath.length > 0
          }

          return isPathInsideDirectory(entryPath, normalizedPath) && entryPath !== normalizedPath
        }

        const directoryEntries = [...index.directories]
          .filter((entry) => entry.length > 0)
          .filter(matchesRecursivePath)
          .map((entry) => ({ type: 'directory' as const, path: entry }))

        const fileEntries = [...index.files.keys()]
          .filter(matchesRecursivePath)
          .map((entry) => ({ type: 'file' as const, path: entry }))

        const allEntries = [...directoryEntries, ...fileEntries].sort((left, right) =>
          left.path.localeCompare(right.path)
        )
        const entries = allEntries.slice(0, getToolLimits().MAX_TOOL_ENTRIES)

        return {
          path: normalizedPath || '/',
          recursive,
          entries,
          totalEntries: allEntries.length,
          hasMore: allEntries.length > entries.length,
        }
      },
    }),
    read_file: tool({
      description:
        'Read a project file by path. Optional line bounds allow partial reads using 1-based inclusive line numbers.',
      inputSchema: z.object({
        path: z.string().describe('File path to read.'),
        start_line: z.number().int().min(1).optional(),
        end_line: z.number().int().min(1).optional(),
      }),
      execute: async ({ path, start_line, end_line }) => {
        const index = await buildProjectFileIndex(
          scope.projectId,
          services.documents.listForProject.bind(services.documents)
        )
        const normalizedPath = normalizeProjectPath(path)
        const documentId = index.files.get(normalizedPath)

        if (!documentId) {
          if (index.directories.has(normalizedPath)) {
            throw new Error(`Path "${path}" is a directory. Use list_files for directories.`)
          }
          throw new Error(`File "${path}" was not found in this project.`)
        }

        const document = await services.documents.getForProject(scope.projectId, documentId)
        if (!document) {
          throw new Error(`File "${path}" is no longer available in this project.`)
        }

        const fullText = renderDocumentContentToMarkdown(document.content)
        const lines = fullText.length > 0 ? fullText.split('\n') : ['']
        const totalLines = lines.length
        const start = Math.max(1, Math.min(start_line ?? 1, totalLines))
        const end = Math.max(start, Math.min(end_line ?? totalLines, totalLines))

        let content = lines.slice(start - 1, end).join('\n')
        let truncated = false
        const toolLimits = getToolLimits()
        if (content.length > toolLimits.MAX_TOOL_READ_CHARS) {
          content = content.slice(0, toolLimits.MAX_TOOL_READ_CHARS)
          truncated = true
        }

        return {
          path: normalizedPath,
          start_line: start,
          end_line: end,
          total_lines: totalLines,
          truncated,
          content,
        }
      },
    }),
    search_file: tool({
      description:
        'Search the active project file for relevant passages using the semantic embedding index.',
      inputSchema: z.object({
        query: z.string().describe('Exact text or natural-language description to search for.'),
        limit: z.number().int().min(1).max(searchToolConfig.maxResultLimit).optional(),
      }),
      execute: async ({ query, limit }) => {
        const document = await services.documents.getForProject(scope.projectId, scope.documentId)
        if (!document) {
          throw new Error('The active file is no longer available in this project.')
        }

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
        const previewMaxLength = searchToolConfig.previewMaxLength
        const resolved = await services.indexingSettings.resolveForDocument(scope.documentId)
        const indexing = buildIndexingSummary(resolved)

        const notes: string[] = [
          'The active-file prompt only contains a bounded local excerpt. Use this tool plus read_file when you need broader document context.',
        ]

        if (!indexing) {
          notes.push(
            'Semantic indexing settings are unavailable for this file right now. Results may be empty until indexing is configured.'
          )
        }

        if (indexing?.type === 'whole_document') {
          notes.push(
            'This document uses whole-document indexing, so semantic search can confirm relevance but may not pinpoint an exact passage.'
          )
        }

        let semanticMatches: SemanticChunkSearchPreview[] = []
        let observedMatchIndexing: ObservedSemanticIndexing | null = null
        try {
          const semanticResults = await services.documents.searchForProjectDocument(
            scope.projectId,
            scope.documentId,
            normalizedQuery,
            { limit: resultLimit }
          )
          observedMatchIndexing = summarizeObservedIndexingFromMatches(semanticResults)
          semanticMatches = formatSemanticChunkSearchMatches(semanticResults, normalizedQuery, {
            limit: resultLimit,
            maxPreviewLength: previewMaxLength,
          })
        } catch (error) {
          noteToolFailure(
            notes,
            'search_file',
            'Semantic search was unavailable for this file.',
            error
          )
        }

        if (
          indexing?.type &&
          observedMatchIndexing?.type &&
          observedMatchIndexing.type !== 'mixed' &&
          indexing.type !== observedMatchIndexing.type
        ) {
          notes.push(
            `Configured indexing is ${indexing.type}, but observed semantic matches behaved like ${observedMatchIndexing.type}. This can happen when embeddings are stale; reindex the document to align settings and search output.`
          )
        }

        return {
          path: normalizeDocumentPath(document.title) || '(untitled)',
          query: normalizedQuery,
          indexing,
          match_indexing: observedMatchIndexing,
          semantic_matches: semanticMatches.map((match) => ({
            match_type: match.matchType,
            chunk_ordinal: match.chunkOrdinal,
            selection_from: match.selectionFrom,
            selection_to: match.selectionTo,
            distance: match.score,
            preview: match.preview,
          })),
          notes,
        }
      },
    }),
    search_project: tool({
      description:
        'Search across project documents for relevant files and passages using the semantic embedding index. Use this when the answer may be outside the active file or you need to discover which documents matter.',
      inputSchema: z.object({
        query: z.string().describe('Exact text or natural-language description to search for.'),
        limit: z.number().int().min(1).max(searchToolConfig.maxResultLimit).optional(),
      }),
      execute: async ({ query, limit }) => {
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
        const notes: string[] = [
          'Use read_file on the returned paths to inspect exact passages after you identify the relevant documents.',
        ]

        let semanticResults: ProjectDocumentSearchResult[] = []
        try {
          semanticResults = await services.documents.searchForProject(
            scope.projectId,
            normalizedQuery,
            {
              limit: resultLimit,
              maxSnippetsPerDocument: searchToolConfig.snippetLimit,
            }
          )
        } catch (error) {
          noteToolFailure(
            notes,
            'search_project',
            'Semantic search was unavailable for this project search.',
            error
          )
        }

        const limitedResults = semanticResults.slice(0, resultLimit)
        const indexingByDocumentId = await buildIndexingSummaries(
          services,
          scope.projectId,
          limitedResults.map((result) => result.id)
        )

        const indexedResults = limitedResults.map((result) => ({
          path: normalizeDocumentPath(result.title) || '(untitled)',
          distance: result.score,
          match_type: result.matchType,
          match_indexing_type:
            result.matchType === 'whole_document' ? 'whole_document' : 'sliding_window',
          updated_at: result.updatedAt,
          indexing: indexingByDocumentId.get(result.id) ?? null,
          snippets: result.snippets.map((snippet) => ({
            selection_from: snippet.selectionFrom,
            selection_to: snippet.selectionTo,
            distance: snippet.score,
            preview: snippet.text,
          })),
        }))

        if (
          indexedResults.some(
            (result) => result.indexing?.type && result.indexing.type !== result.match_indexing_type
          )
        ) {
          notes.push(
            'Some configured indexing settings differ from observed semantic match behavior in current embeddings. If results look inconsistent, refresh embeddings for the affected documents.'
          )
        }

        if (indexedResults.some((result) => result.indexing?.type === 'whole_document')) {
          notes.push(
            'Some returned documents use whole-document indexing, so they may be relevant without a precise snippet location.'
          )
        }

        return {
          query: normalizedQuery,
          results: indexedResults,
          notes,
        }
      },
    }),
  }
}

export function buildInlineZoneWriteTools(options: BuildInlineToolsOptions) {
  return {
    write_zone: tool({
      description:
        'Write text only inside the active AI zone. Use fromOffset/toOffset relative to the zone text. Set fromOffset == toOffset to insert.',
      inputSchema: inlineZoneWriteToolInputSchema,
      execute: async ({ fromOffset, toOffset, content }) => {
        const normalizedFrom = fromOffset ?? 0
        const normalizedTo = toOffset ?? normalizedFrom
        const action: InlineZoneReplaceAction = {
          type: 'replace_range',
          fromOffset: normalizedFrom,
          toOffset: normalizedTo,
          content,
        }
        await options.onWriteAction(action)
        return {
          ok: true,
          applied: action,
        }
      },
    }),
    write_zone_choices: tool({
      description:
        'Set candidate alternatives for the active AI zone. This replaces the whole zone with user-selectable options.',
      inputSchema: inlineZoneChoicesToolInputSchema,
      execute: async ({ choices }) => {
        const normalizedChoices = normalizeInlineZoneChoices(choices)
        const action: InlineZoneChoicesAction = {
          type: 'set_choices',
          choices: normalizedChoices,
        }
        await options.onWriteAction(action)
        return {
          ok: true,
          applied: action,
        }
      },
    }),
  }
}

export function hasValidToolScope(value: {
  projectId?: string
  documentId?: string
}): value is ToolScope {
  return (
    typeof value.projectId === 'string' &&
    value.projectId.length > 0 &&
    typeof value.documentId === 'string' &&
    value.documentId.length > 0
  )
}
