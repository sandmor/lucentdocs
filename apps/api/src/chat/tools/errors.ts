export function formatPathIsFile(path: string): Error {
  return new Error(
    `Path "${path}" is a file. Use read with offset/limit to inspect file contents, or grep/search to find passages.`
  )
}

export function formatPathIsDirectory(path: string): Error {
  return new Error(
    `Path "${path}" is a directory. Use read to list directory entries, or glob to find files by pattern within it.`
  )
}

export function formatPathNotFound(path: string, suggestions: readonly string[]): Error {
  const lines = [`Path "${path}" was not found in this project.`]
  if (suggestions.length > 0) {
    lines.push('', 'Did you mean one of these?', ...suggestions)
  }
  lines.push('', 'Use glob to discover paths by pattern, or read on a directory path to list entries.')
  return new Error(lines.join('\n'))
}

export function logToolFailure(toolName: string, context: string, error: unknown): void {
  const includeErrorDetails = process.env.LUCENTDOCS_DEBUG_TOOL_ERRORS === '1'
  const errorSummary =
    error instanceof Error
      ? `${error.name}${error.message ? `: ${error.message}` : ''}`
      : 'unknown error'

  if (includeErrorDetails) {
    console.warn(`[${toolName}] ${context}`, error)
    return
  }

  console.warn(`[${toolName}] ${context} (${errorSummary})`)
}
