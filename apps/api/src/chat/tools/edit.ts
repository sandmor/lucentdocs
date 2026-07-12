import { tool } from 'ai'
import { z } from 'zod/v4'
import { projectSyncBus } from '../../trpc/project-sync.js'
import { EDIT_DESCRIPTION } from './descriptions/index.js'
import {
  applyDocumentManuscriptEdits,
  assertMarkerAnchorsPreserved,
} from './document-edit-plan.js'
import { hashManuscriptText, projectDocumentManuscript } from './document-manuscript.js'
import { EditGuardError } from './document-edit-session.js'
import { EditToolError } from './edit-errors.js'
import { normalizeEditNeedle, validateEditReplacement } from './edit-input.js'
import { matchManuscript } from './manuscript-edit-match.js'
import { formatPathNotFound } from './errors.js'
import {
  formatXmlCloseTag,
  formatXmlElement,
  formatXmlOpenTag,
  formatXmlSelfClosingTag,
} from './structured-output.js'
import { loadProjectFileIndex, resolveNormalizedPath, suggestPaths } from './paths.js'
import type { BuildEditToolsContext } from './types.js'

const documentLocks = new Map<string, Promise<void>>()

async function withDocumentLock<T>(documentId: string, task: () => Promise<T>): Promise<T> {
  const previous = documentLocks.get(documentId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const chain = previous.then(() => gate)
  documentLocks.set(documentId, chain)
  await previous

  try {
    return await task()
  } finally {
    release()
    if (documentLocks.get(documentId) === chain) {
      documentLocks.delete(documentId)
    }
  }
}

function formatEditOutput(options: {
  path: string
  replacements: number
  warnings: string[]
}): string {
  const parts = [
    formatXmlOpenTag('edit', { path: options.path, replacements: options.replacements }),
    'Edit applied successfully.',
  ]

  if (options.warnings.length > 0) {
    parts.push(formatXmlOpenTag('warnings'))
    parts.push(...options.warnings.map((warning) => formatXmlElement('warning', { text: warning })))
    parts.push(formatXmlCloseTag('warnings'))
  }

  parts.push(
    formatXmlSelfClosingTag('meta', {
      suggested_next: 'read',
      path: options.path,
    }),
    formatXmlCloseTag('edit')
  )

  return parts.join('\n')
}

function toThrownError(error: unknown): never {
  if (error instanceof EditToolError || error instanceof EditGuardError) {
    throw error
  }
  throw error
}

export function createEditTool(context: BuildEditToolsContext) {
  return tool({
    description: EDIT_DESCRIPTION,
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          'Project-relative document path without a leading slash (e.g. "chapters/one.md").'
        ),
      old_string: z
        .string()
        .describe(
          'Exact manuscript text to replace. Must not include line numbers or annotation tags.'
        ),
      new_string: z.string().describe('Replacement manuscript text.'),
      replace_all: z
        .boolean()
        .optional()
        .describe('Replace every occurrence of old_string (default false).'),
    }),
    execute: async ({ path, old_string, new_string, replace_all = false }) => {
      if (old_string === new_string) {
        throw new EditToolError(
          'no_changes',
          'No changes to apply: old_string and new_string are identical.'
        )
      }

      const index = await loadProjectFileIndex(context.scope.projectId, context.services)
      const normalizedPath = resolveNormalizedPath(path)
      const documentId = index.files.get(normalizedPath)
      if (!documentId) {
        const suggestions = suggestPaths(path, index)
        throw formatPathNotFound(path, suggestions)
      }

      try {
        context.editSession.assertPathRead(normalizedPath)
      } catch (error) {
        toThrownError(error)
      }

      const normalizedNeedle = normalizeEditNeedle(old_string)
      if (normalizedNeedle.text.length === 0) {
        throw new EditToolError(
          'not_found',
          'old_string is empty after removing annotation markup. Provide exact manuscript text from read output.',
          { hint: 'Copy manuscript text only, without line numbers or <annotation> tags.' }
        )
      }

      const replacement = validateEditReplacement(new_string)

      return withDocumentLock(documentId, async () => {
        const noteRows = await context.services.documentNotes.listByDocumentId(documentId)
        const markerAnchoredIds = new Set(
          noteRows.filter((note) => note.anchorKind === 'marker').map((note) => note.anchorId)
        )

        const transformed = await context.yjsRuntime.applyProsemirrorTransform(documentId, {
          origin: 'chat-edit',
          transform: (currentDoc) => {
            const manuscript = projectDocumentManuscript(currentDoc)
            const currentHash = hashManuscriptText(manuscript)

            try {
              context.editSession.assertHashCurrent(normalizedPath, currentHash)
            } catch (error) {
              if (error instanceof EditGuardError && error.code === 'content_changed') {
                throw new EditToolError('stale_read', error.message, {
                  hint: 'Re-read the file and retry the edit with fresh manuscript text.',
                })
              }
              throw error
            }

            const matched = matchManuscript(manuscript, normalizedNeedle.text)
            if (matched.ranges.length === 0) {
              const diagnostic = matched.diagnostic
              throw new EditToolError(
                'not_found',
                diagnostic?.nearLine
                  ? `old_string not found in content. A similar passage starts near line ${diagnostic.nearLine}.`
                  : 'old_string not found in content.',
                {
                  hint: diagnostic?.hint,
                  nearLine: diagnostic?.nearLine,
                  nearOffset: diagnostic?.nearManuscriptOffset,
                }
              )
            }

            if (matched.ranges.length > 1 && !replace_all) {
              throw new EditToolError(
                'ambiguous',
                'Found multiple matches for old_string. Provide more surrounding lines in old_string to identify the correct match, or set replace_all=true.',
                { hint: 'Narrow old_string with more surrounding manuscript context.' }
              )
            }

            const planned = applyDocumentManuscriptEdits(currentDoc, matched.ranges, replacement, {
              replaceAll: replace_all,
            })

            assertMarkerAnchorsPreserved(currentDoc, planned.nextDoc, markerAnchoredIds)

            return {
              changed: planned.changed,
              nextDoc: planned.nextDoc,
              result: planned,
            }
          },
        })

        if (transformed.changed) {
          await context.yjsRuntime.reconcileDocumentNotesAfterEdit(documentId, {
            deletedBlockIds: transformed.result.deletedBlockIds,
            blockIdMigrations: transformed.result.blockIdMigrations,
          })
        }

        const nextHash = hashManuscriptText(projectDocumentManuscript(transformed.nextDoc))
        context.editSession.markEdited(normalizedPath, nextHash)

        projectSyncBus.publish({
          type: 'documents.changed',
          projectId: context.scope.projectId,
          reason: 'chat.edit',
          changedDocumentIds: [documentId],
          deletedDocumentIds: [],
          defaultDocumentId: null,
        })

        return {
          kind: 'edit' as const,
          path: normalizedPath,
          replacements: transformed.result.replacements,
          output: formatEditOutput({
            path: normalizedPath,
            replacements: transformed.result.replacements,
            warnings: transformed.result.warnings,
          }),
          meta: {
            suggested_next: 'read',
            path: normalizedPath,
          },
        }
      })
    },
  })
}

export function buildEditTools(context: BuildEditToolsContext) {
  return {
    edit: createEditTool(context),
  }
}
