import { tool } from 'ai'
import { z } from 'zod/v4'
import {
  parseNoteBodyContent,
  proseMirrorDocToMarkdown,
  type JsonObject,
} from '@lucentdocs/shared'
import { GREP_DESCRIPTION } from './descriptions/index.js'
import type { AiAnnotationNote } from '../../ai/annotation-context.js'
import { loadDocumentText, stripAnnotationMarkup } from './document-text.js'
import { formatPathNotFound } from './errors.js'
import { pathMatchesInclude } from './glob-matcher.js'
import { buildPaginationMeta } from './meta.js'
import { loadProjectFileIndex, resolveNormalizedPath, suggestPaths } from './paths.js'
import { DEFAULT_GREP_MATCH_LIMIT, type BuildReadToolsContext } from './types.js'

const MAX_GREP_REGEX_PATTERN_CHARS = 500

interface GrepMatch {
  path: string
  line: number
  text: string
  source: 'manuscript' | 'annotation'
}

export function createGrepTool(context: BuildReadToolsContext) {
  return tool({
    description: GREP_DESCRIPTION,
    inputSchema: z.object({
      pattern: z.string().describe('Substring or regular expression to search for in document text.'),
      path: z
        .string()
        .optional()
        .describe(
          'Optional file or directory prefix to scope the search (project-relative, no leading slash).'
        ),
      include: z
        .string()
        .optional()
        .describe('Optional path glob filter, e.g. "*.md".'),
      regex: z
        .boolean()
        .optional()
        .describe('When true, treat pattern as a JavaScript regular expression.'),
      include_annotations: z
        .boolean()
        .optional()
        .describe('When true, also search author annotation note bodies.'),
      limit: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(`Maximum number of matches to return (defaults to ${DEFAULT_GREP_MATCH_LIMIT}).`),
    }),
    execute: async ({
      pattern,
      path,
      include,
      regex = false,
      include_annotations = false,
      limit,
    }) => {
      if (!pattern.trim()) {
        throw new Error('pattern is required.')
      }

      const index = await loadProjectFileIndex(context.scope.projectId, context.services)
      const scopedPath = path ? resolveNormalizedPath(path) : ''
      const matchLimit = limit ?? DEFAULT_GREP_MATCH_LIMIT
      const matcher = buildLineMatcher(pattern, regex)

      if (scopedPath && index.directories.has(scopedPath) && !index.files.has(scopedPath)) {
        // directory scope — ok
      } else if (scopedPath && !index.files.has(scopedPath) && !index.directories.has(scopedPath)) {
        throw formatPathNotFound(path ?? scopedPath, suggestPaths(path ?? scopedPath, index))
      }

      const candidatePaths = [...index.files.keys()]
        .filter((entry) => {
          if (scopedPath) {
            if (index.files.has(scopedPath) && entry !== scopedPath) return false
            if (index.directories.has(scopedPath) && entry !== scopedPath && !entry.startsWith(`${scopedPath}/`)) {
              return false
            }
          }
          if (include && !pathMatchesInclude(include, entry)) return false
          return true
        })
        .sort((left, right) => left.localeCompare(right))

      const matches: GrepMatch[] = []
      let truncated = false

      for (const candidatePath of candidatePaths) {
        if (matches.length >= matchLimit) {
          truncated = true
          break
        }

        const documentId = index.files.get(candidatePath)
        if (!documentId) continue

        const loaded = await loadDocumentText(
          context.services,
          context.scope.projectId,
          documentId,
          candidatePath,
          { includeAnnotations: false }
        )
        if (!loaded) continue

        const manuscriptLines = stripAnnotationMarkup(loaded.content).split('\n')
        for (let lineIndex = 0; lineIndex < manuscriptLines.length; lineIndex += 1) {
          if (matches.length >= matchLimit) {
            truncated = true
            break
          }
          const lineText = manuscriptLines[lineIndex]
          if (!matcher(lineText)) continue
          matches.push({
            path: candidatePath,
            line: lineIndex + 1,
            text: lineText,
            source: 'manuscript',
          })
        }

        if (!include_annotations || matches.length >= matchLimit) continue

        for (const note of loaded.noteRows) {
          if (matches.length >= matchLimit) {
            truncated = true
            break
          }
          const body = annotationBodyToText(note)
          if (!matcher(body)) continue
          matches.push({
            path: candidatePath,
            line: 0,
            text: body,
            source: 'annotation',
          })
        }
      }

      return {
        pattern,
        path: scopedPath || undefined,
        matches: matches.map((match) => ({
          path: match.path,
          line: match.line,
          text: match.text,
          source: match.source,
        })),
        match_count: matches.length,
        output: formatGrepOutput(matches, truncated),
        meta: buildPaginationMeta({
          truncated,
          hasMore: truncated,
          nextOffset: null,
          suggestedNext: matches.length > 0 ? 'read' : 'grep',
        }),
      }
    },
  })
}

function buildLineMatcher(pattern: string, regex: boolean): (line: string) => boolean {
  if (regex) {
    if (pattern.length > MAX_GREP_REGEX_PATTERN_CHARS) {
      throw new Error(
        `Regex pattern exceeds maximum length of ${MAX_GREP_REGEX_PATTERN_CHARS} characters.`
      )
    }

    let expression: RegExp
    try {
      expression = new RegExp(pattern, 'i')
    } catch {
      throw new Error(`Invalid regular expression pattern: ${pattern}`)
    }

    return (line) => expression.test(line)
  }

  const loweredPattern = pattern.toLowerCase()
  return (line) => line.toLowerCase().includes(loweredPattern)
}

function annotationBodyToText(note: AiAnnotationNote): string {
  const content =
    typeof note.content === 'string' ? parseNoteBodyContent(note.content) : (note.content as JsonObject)
  const rendered = proseMirrorDocToMarkdown(content)
  if (rendered.ok) return rendered.value.trim()
  return ''
}

function formatGrepOutput(matches: GrepMatch[], truncated: boolean): string {
  if (matches.length === 0) {
    return 'No matches found. Try a different pattern, broaden path, or use search for semantic lookup.'
  }

  const lines = [`Found ${matches.length} match${matches.length === 1 ? '' : 'es'}${truncated ? ' (truncated)' : ''}`]
  let currentPath = ''

  for (const match of matches) {
    if (currentPath !== match.path) {
      if (currentPath !== '') lines.push('')
      currentPath = match.path
      lines.push(`${match.path}:`)
    }

    if (match.source === 'annotation') {
      lines.push(`  [annotation] ${match.text}`)
      continue
    }

    lines.push(`  Line ${match.line}: ${match.text}`)
  }

  if (truncated) {
    lines.push('', '(Results truncated. Use a more specific path, include filter, or smaller scope.)')
  }

  return lines.join('\n')
}
