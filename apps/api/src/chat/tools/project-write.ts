import { tool } from 'ai'
import { ensureBlockIds, schema, type JsonObject } from '@lucentdocs/shared'
import { z } from 'zod/v4'
import { markdownToProseMirrorDoc } from '../../core/markdown/native.js'
import { projectSyncBus } from '../../trpc/project-sync.js'
import { WRITE_DESCRIPTION } from './descriptions/index.js'
import { withDocumentLock } from './document-lock.js'
import { EditGuardError } from './document-edit-session.js'
import { hashManuscriptText, projectDocumentManuscript } from './document-manuscript.js'
import { EditToolError } from './edit-errors.js'
import { validateEditReplacement } from './edit-input.js'
import { loadProjectFileIndex, resolveNormalizedPath } from './paths.js'
import { formatXmlCloseTag, formatXmlOpenTag, formatXmlSelfClosingTag } from './structured-output.js'
import type { BuildEditToolsContext } from './types.js'

function parseManuscript(content: string) {
  const replacement = validateEditReplacement(content)
  const parsed = markdownToProseMirrorDoc(replacement)
  if (!parsed.ok) {
    throw new EditToolError('markdown_parse_failed', 'Failed to parse manuscript Markdown.', {
      hint: 'Provide valid manuscript Markdown for content.',
    })
  }
  return schema.nodeFromJSON(ensureBlockIds(parsed.value))
}

function formatWriteOutput(options: {
  path: string
  action: 'created' | 'populated' | 'overwritten'
  annotationsDeleted: number
}): string {
  const parts = [
    formatXmlOpenTag('write', {
      path: options.path,
      action: options.action,
      annotations_deleted: options.annotationsDeleted,
    }),
    `Document ${options.action} successfully.`,
  ]
  if (options.annotationsDeleted > 0) {
    parts.push(`Removed ${options.annotationsDeleted} author annotation(s) during full overwrite.`)
  }
  parts.push(
    formatXmlSelfClosingTag('meta', { suggested_next: 'read', path: options.path }),
    formatXmlCloseTag('write')
  )
  return parts.join('\n')
}

export function createWriteTool(context: BuildEditToolsContext) {
  return tool({
    description: WRITE_DESCRIPTION,
    inputSchema: z.object({
      path: z.string().describe('Project-relative document path without a leading slash.'),
      content: z.string().describe('Complete replacement manuscript Markdown.'),
      overwrite: z.boolean().optional().describe('Required to replace a non-empty or annotated existing document.'),
    }),
    execute: async ({ path, content, overwrite = false }) => {
      const normalizedPath = resolveNormalizedPath(path)
      if (!normalizedPath) throw new EditToolError('invalid_path', 'A non-empty file path is required.')

      const replacementDoc = parseManuscript(content)
      const index = await loadProjectFileIndex(context.scope.projectId, context.services)
      const documentId = index.files.get(normalizedPath)

      if (!documentId) {
        if (index.directories.has(normalizedPath)) {
          throw new EditToolError('path_conflict', `Cannot create "${normalizedPath}" because it is a directory.`)
        }
        const created = await context.services.documents.createForProject(
          context.scope.projectId,
          normalizedPath,
          JSON.stringify({ doc: replacementDoc.toJSON() as JsonObject, aiDraft: null })
        )
        if (!created) {
          throw new EditToolError('path_conflict', `Cannot create document at "${normalizedPath}" due to a path conflict.`, {
            hint: 'Choose an unused path that does not conflict with a file or directory.',
          })
        }
        context.editSession.markEdited(normalizedPath, hashManuscriptText(projectDocumentManuscript(replacementDoc)))
        const defaultDocumentId = await context.services.documents.getDefaultDocumentIdForProject(context.scope.projectId)
        projectSyncBus.publish({
          type: 'documents.changed', projectId: context.scope.projectId, reason: 'chat.write',
          changedDocumentIds: [created.id], deletedDocumentIds: [], defaultDocumentId,
        })
        return {
          kind: 'write' as const, path: normalizedPath, action: 'created' as const, annotationsDeleted: 0,
          output: formatWriteOutput({ path: normalizedPath, action: 'created', annotationsDeleted: 0 }),
          meta: { suggested_next: 'read', path: normalizedPath },
        }
      }

      context.editSession.assertPathRead(normalizedPath)
      return withDocumentLock(documentId, async () => {
        const transformed = await context.yjsRuntime.applyProsemirrorTransform(documentId, {
          origin: 'chat-write', clearNotes: overwrite,
          transform: (currentDoc, { notes }) => {
            const manuscript = projectDocumentManuscript(currentDoc)
            try {
              context.editSession.assertHashCurrent(normalizedPath, hashManuscriptText(manuscript))
            } catch (error) {
              if (error instanceof EditGuardError && error.code === 'content_changed') {
                throw new EditToolError('stale_read', error.message, { hint: 'Re-read the file and retry the write with fresh manuscript text.' })
              }
              throw error
            }
            if ((manuscript.length > 0 || notes.length > 0) && !overwrite) {
              throw new EditToolError('overwrite_required', `"${normalizedPath}" is not empty. Set overwrite=true to replace its complete content.`, {
                hint: 'Use edit for a targeted change, or set overwrite=true for an intentional full rewrite.',
              })
            }
            if (manuscript === content.trimEnd()) {
              throw new EditToolError('no_changes', 'No changes to apply: content already matches the manuscript.')
            }
            return {
              changed: true,
              nextDoc: replacementDoc,
              result: { annotationsDeleted: overwrite ? notes.length : 0 },
            }
          },
        })
        context.editSession.markEdited(normalizedPath, hashManuscriptText(projectDocumentManuscript(transformed.nextDoc)))
        const annotationsDeleted = transformed.result.annotationsDeleted
        const action = overwrite ? 'overwritten' : 'populated'
        projectSyncBus.publish({
          type: 'documents.changed', projectId: context.scope.projectId, reason: 'chat.write',
          changedDocumentIds: [documentId], deletedDocumentIds: [], defaultDocumentId: null,
        })
        return {
          kind: 'write' as const, path: normalizedPath, action, annotationsDeleted,
          output: formatWriteOutput({ path: normalizedPath, action, annotationsDeleted }),
          meta: { suggested_next: 'read', path: normalizedPath },
        }
      })
    },
  })
}

export function buildWriteTools(context: BuildEditToolsContext) {
  return { write: createWriteTool(context) }
}
