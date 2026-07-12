import { createGlobTool } from './glob.js'
import { createGrepTool } from './grep.js'
import { createReadTool } from './read.js'
import { createSearchTool } from './search.js'
import type { BuildEditToolsContext, BuildReadToolsContext, ToolScope } from './types.js'

export { buildInlineZoneWriteTools } from './write.js'
export { buildEditTools } from './edit.js'
export type { BuildEditToolsContext, BuildReadToolsContext, ToolScope }

export function buildReadTools(context: BuildReadToolsContext) {
  return {
    read: createReadTool(context),
    glob: createGlobTool(context),
    grep: createGrepTool(context),
    search: createSearchTool(context),
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
