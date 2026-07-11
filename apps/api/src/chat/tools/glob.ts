import { tool } from 'ai'
import { z } from 'zod/v4'
import type { ProjectFileIndex } from '../utils.js'
import { getToolLimits } from '../utils.js'
import { GLOB_DESCRIPTION } from './descriptions/index.js'
import { pathMatchesGlob } from './glob-matcher.js'
import { buildPaginationMeta } from './meta.js'
import { loadProjectFileIndex, resolveNormalizedPath } from './paths.js'
import type { BuildReadToolsContext } from './types.js'

function entryMatchesScope(
  entry: string,
  scopedPrefix: string,
  index: ProjectFileIndex
): boolean {
  if (!scopedPrefix) return true
  if (index.files.has(scopedPrefix)) return entry === scopedPrefix
  return entry.startsWith(`${scopedPrefix}/`)
}

export function createGlobTool(context: BuildReadToolsContext) {
  return tool({
    description: GLOB_DESCRIPTION,
    inputSchema: z.object({
      pattern: z
        .string()
        .describe('Glob pattern to match document paths, e.g. "**/*.md" or "chapters/*".'),
      path: z
        .string()
        .optional()
        .describe(
          'Optional directory prefix to scope matching (project-relative, no leading slash). Omit to search the whole project.'
        ),
      offset: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('1-based index into the sorted match list for pagination.'),
      limit: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Maximum number of paths to return.'),
    }),
    execute: async ({ pattern, path, offset, limit }) => {
      const index = await loadProjectFileIndex(context.scope.projectId, context.services)
      const scopedPrefix = path ? resolveNormalizedPath(path) : ''
      const sortedPaths = [...index.files.keys()]
        .filter((entry) => entryMatchesScope(entry, scopedPrefix, index))
        .filter((entry) => pathMatchesGlob(pattern, entry))
        .sort((left, right) => left.localeCompare(right))

      const pageOffset = Math.max(0, (offset ?? 1) - 1)
      const pageLimit = limit ?? getToolLimits().MAX_TOOL_ENTRIES
      const pagePaths = sortedPaths.slice(pageOffset, pageOffset + pageLimit)
      const truncated = sortedPaths.length > pageOffset + pagePaths.length
      const nextOffset = truncated ? pageOffset + pagePaths.length + 1 : null

      return {
        pattern,
        path: scopedPrefix || '/',
        paths: pagePaths,
        total_matches: sortedPaths.length,
        output:
          pagePaths.length > 0
            ? pagePaths.join('\n')
            : 'No files found. Try a broader pattern or use read on a directory path.',
        meta: buildPaginationMeta({
          truncated,
          hasMore: truncated,
          nextOffset,
          suggestedNext: pagePaths.length > 0 ? 'read' : 'glob',
        }),
      }
    },
  })
}
