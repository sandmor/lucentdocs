import { tool } from 'ai'
import { z } from 'zod/v4'
import {
  isPathInsideDirectory,
  parentDocumentPath,
  inlineZoneChoicesToolInputSchema,
  inlineZoneWriteToolInputSchema,
  normalizeInlineZoneChoices,
  type InlineZoneWriteAction,
  type InlineZoneReplaceAction,
  type InlineZoneChoicesAction,
} from '@plotline/shared'
import type { ServiceSet } from '../core/services/types.js'
import {
  buildProjectFileIndex,
  getToolLimits,
  normalizeProjectPath,
  projectDocumentToMarkdown,
} from './utils.js'

export interface ToolScope {
  projectId: string
  documentId: string
}

interface BuildInlineToolsOptions {
  onWriteAction: (action: InlineZoneWriteAction) => void
}

type BuildReadToolsContext = {
  scope: ToolScope
  services: ServiceSet
}

export function buildReadTools({ scope, services }: BuildReadToolsContext) {
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

        const fullText = projectDocumentToMarkdown(document.content)
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
        options.onWriteAction(action)
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
        options.onWriteAction(action)
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
