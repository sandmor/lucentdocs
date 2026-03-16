import type { JsonObject } from '@lucentdocs/shared'
import {
  importMarkdownDocumentsSqlite,
  parseMarkdown,
  planMarkdownImport as planMarkdownImportNative,
  type MarkdownRawHtmlMode as CoreRawHtmlMode,
} from '@lucentdocs/core'

export interface MarkdownError {
  kind: 'parse_failed' | 'plan_failed'
  cause: unknown
}

export type MarkdownResult<T> = { ok: true; value: T } | { ok: false; error: MarkdownError }

export type MarkdownRawHtmlMode = 'drop' | 'code_block'

export type MarkdownSplitStrategy =
  | { type: 'none' }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: 'size' }

export interface MarkdownImportPlanOptions {
  maxDocChars: number
  targetDocChars?: number
  split: MarkdownSplitStrategy
  rawHtmlMode?: MarkdownRawHtmlMode
}

export interface MarkdownImportPlanPart {
  markdown: string
  suggestedTitle: string | null
  estimatedChars: number
}

export interface MarkdownHtmlDetection {
  htmlTagCount: number
  tags: Record<string, number>
  hasLikelyHtmlBlocks: boolean
}

export interface MarkdownImportPlanResult {
  normalizedMarkdown: string
  parts: MarkdownImportPlanPart[]
  html: MarkdownHtmlDetection
}

export interface NativeMassImportDocumentInput {
  title: string
  markdown: string
}

export interface NativeMassImportRequest {
  projectId: string
  documents: NativeMassImportDocumentInput[]
  parseFailureMode?: 'fail' | 'code_block'
  rawHtmlMode?: MarkdownRawHtmlMode
}

export interface NativeMassImportFailure {
  title: string
  error: {
    kind: 'invalid_project_id' | 'invalid_path' | 'project_not_found' | 'markdown_parse_failed'
    cause?: unknown
  }
}

export interface NativeMassImportedDocument {
  id: string
  title: string
}

export interface NativeMassImportResult {
  imported: NativeMassImportedDocument[]
  failed: NativeMassImportFailure[]
}

function toNativeRawHtmlMode(mode: MarkdownRawHtmlMode | undefined): CoreRawHtmlMode | undefined {
  if (mode === 'drop') return 'Drop' as CoreRawHtmlMode
  if (mode === 'code_block') return 'CodeBlock' as CoreRawHtmlMode
  return undefined
}

export function markdownToProseMirrorDoc(
  markdown: string,
  options?: { rawHtmlMode?: MarkdownRawHtmlMode }
): MarkdownResult<JsonObject> {
  try {
    const rawHtmlMode = toNativeRawHtmlMode(options?.rawHtmlMode)
    const jsonString = parseMarkdown(markdown, { rawHtmlMode })
    const value = JSON.parse(jsonString) as JsonObject
    return { ok: true, value }
  } catch (e) {
    return { ok: false, error: { kind: 'parse_failed', cause: e } }
  }
}

export function planMarkdownImport(
  markdown: string,
  options: MarkdownImportPlanOptions
): MarkdownResult<MarkdownImportPlanResult> {
  try {
    const rawHtmlMode = toNativeRawHtmlMode(options.rawHtmlMode)
    const nativeResult = planMarkdownImportNative(markdown, {
      maxDocChars: options.maxDocChars,
      targetDocChars: options.targetDocChars ?? undefined,
      split: {
        type: options.split.type,
        level: options.split.type === 'heading' ? options.split.level : undefined,
      },
      rawHtmlMode,
    })

    return {
      ok: true,
      value: {
        normalizedMarkdown: nativeResult.normalizedMarkdown,
        html: {
          htmlTagCount: nativeResult.html.htmlTagCount,
          hasLikelyHtmlBlocks: nativeResult.html.hasLikelyHtmlBlocks,
          tags: nativeResult.html.tags,
        },
        parts: nativeResult.parts.map((part) => ({
          markdown: part.markdown,
          estimatedChars: part.estimatedChars,
          suggestedTitle: part.suggestedTitle ?? null,
        })),
      },
    }
  } catch (e) {
    return { ok: false, error: { kind: 'plan_failed', cause: e } }
  }
}

export async function runNativeMassImportSqlite(
  dbPath: string,
  request: NativeMassImportRequest
): Promise<NativeMassImportResult> {
  const rawHtmlMode = toNativeRawHtmlMode(request.rawHtmlMode)
  const response = await importMarkdownDocumentsSqlite(dbPath, {
    projectId: request.projectId,
    documents: request.documents,
    parseFailureMode: request.parseFailureMode,
    rawHtmlMode,
  })

  const parsed = JSON.parse(response) as {
    imported: Array<{ id: string; title: string }>
    failed: NativeMassImportFailure[]
  }

  return {
    imported: parsed.imported.map((item) => ({
      id: item.id,
      title: item.title,
    })),
    failed: parsed.failed,
  }
}
