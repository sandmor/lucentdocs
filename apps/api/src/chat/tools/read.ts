import { tool } from 'ai'
import { z } from 'zod/v4'
import { getToolLimits } from '../utils.js'
import { READ_DESCRIPTION } from './descriptions/index.js'
import {
  buildAnnotationBlockForSlice,
  formatReadDirectoryOutput,
  formatReadFileOutput,
  loadDocumentText,
  stripAnnotationMarkup,
} from './document-text.js'
import { formatPathNotFound } from './errors.js'
import { buildPaginationMeta } from './meta.js'
import { listDirectoryEntries, loadProjectFileIndex, resolveNormalizedPath, suggestPaths } from './paths.js'
import { DEFAULT_READ_LINE_LIMIT, type BuildReadToolsContext } from './types.js'

export function createReadTool(context: BuildReadToolsContext) {
  return tool({
    description: READ_DESCRIPTION,
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          'Project-relative file or directory path without a leading slash. Use "" or "/" for the project root directory.'
        ),
      offset: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          'Pagination offset (1-based). For files this is the starting line number; for directories this is the starting entry index.'
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          'Maximum items to return. For files this is a line count; for directories this is an entry count.'
        ),
      include_annotations: z
        .boolean()
        .optional()
        .describe(
          'When true (default), include annotation markers in lines and author note bodies in a separate annotations block.'
        ),
    }),
    execute: async ({ path, offset, limit, include_annotations = true }) => {
      const index = await loadProjectFileIndex(context.scope.projectId, context.services)
      const normalizedPath = resolveNormalizedPath(path)
      const documentId = index.files.get(normalizedPath)

      if (documentId) {
        return readProjectFile(context, documentId, normalizedPath, {
          offset,
          limit,
          includeAnnotations: include_annotations,
        })
      }

      if (index.directories.has(normalizedPath)) {
        return listProjectDirectory(normalizedPath, index, { offset, limit })
      }

      const suggestions = suggestPaths(path, index)
      throw formatPathNotFound(path, suggestions)
    },
  })
}

async function readProjectFile(
  context: BuildReadToolsContext,
  documentId: string,
  normalizedPath: string,
  options: {
    offset?: number
    limit?: number
    includeAnnotations: boolean
  }
) {
  const loaded = await loadDocumentText(
    context.services,
    context.scope.projectId,
    documentId,
    normalizedPath,
    { includeAnnotations: options.includeAnnotations }
  )

  if (!loaded) {
    throw new Error(`File "${normalizedPath}" is no longer available in this project.`)
  }

  let fullText = loaded.content
  if (!options.includeAnnotations) {
    fullText = stripAnnotationMarkup(fullText)
  }

  const lines = fullText.length > 0 ? fullText.split('\n') : ['']
  const totalLines = lines.length
  const lineLimit = options.limit ?? DEFAULT_READ_LINE_LIMIT
  const startLine = Math.max(1, Math.min(options.offset ?? 1, totalLines))
  const requestedEnd = startLine + lineLimit - 1
  const endLine = Math.max(startLine, Math.min(requestedEnd, totalLines))
  const lineTruncated = endLine < totalLines

  let sliceLines = lines.slice(startLine - 1, endLine)
  let charTruncated = false
  const toolLimits = getToolLimits()
  let sliceText = sliceLines.join('\n')
  if (sliceText.length > toolLimits.MAX_TOOL_READ_CHARS) {
    sliceText = sliceText.slice(0, toolLimits.MAX_TOOL_READ_CHARS)
    charTruncated = true
    sliceLines = sliceText.split('\n')
  }

  const annotationsBlock =
    options.includeAnnotations && loaded.noteRows.length > 0
      ? buildAnnotationBlockForSlice(
          loaded.noteRows,
          sliceLines.join('\n'),
          loaded.aliasToNoteId
        )
      : ''

  const truncated = lineTruncated || charTruncated
  const nextOffset = lineTruncated ? endLine + 1 : charTruncated ? startLine : null

  return {
    kind: 'file' as const,
    path: normalizedPath,
    start_line: startLine,
    end_line: startLine + sliceLines.length - 1,
    total_lines: totalLines,
    output: formatReadFileOutput({
      path: normalizedPath,
      lines: sliceLines,
      startLine,
      endLine: startLine + sliceLines.length - 1,
      totalLines,
      annotationsBlock,
      truncated,
      nextOffset,
    }),
    meta: buildPaginationMeta({
      truncated,
      hasMore: truncated,
      nextOffset,
      charTruncated,
      suggestedNext: truncated ? 'read' : undefined,
      summary: charTruncated
        ? 'Output was truncated by the character limit. Re-read the same offset with a smaller limit.'
        : undefined,
    }),
  }
}

function listProjectDirectory(
  normalizedPath: string,
  index: Awaited<ReturnType<typeof loadProjectFileIndex>>,
  options: { offset?: number; limit?: number }
) {
  const allEntries = listDirectoryEntries(index, normalizedPath)
  const entryOffset = Math.max(0, (options.offset ?? 1) - 1)
  const entryLimit = options.limit ?? getToolLimits().MAX_TOOL_ENTRIES
  const pageEntries = allEntries.slice(entryOffset, entryOffset + entryLimit)
  const formattedEntries = pageEntries.map((entry) =>
    entry.type === 'directory' ? `${entry.path}/` : entry.path
  )
  const truncated = allEntries.length > entryOffset + pageEntries.length
  const nextOffset = truncated ? entryOffset + pageEntries.length + 1 : null

  return {
    kind: 'directory' as const,
    path: normalizedPath || '/',
    entries: formattedEntries,
    total_entries: allEntries.length,
    output: formatReadDirectoryOutput({
      path: normalizedPath,
      entries: formattedEntries,
      offset: entryOffset + 1,
      totalEntries: allEntries.length,
      truncated,
      nextOffset,
    }),
    meta: buildPaginationMeta({
      truncated,
      hasMore: truncated,
      nextOffset,
      suggestedNext: 'read',
    }),
  }
}
