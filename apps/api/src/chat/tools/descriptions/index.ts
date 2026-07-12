import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const descriptionsDir = dirname(fileURLToPath(import.meta.url))

function loadDescription(filename: string): string {
  return readFileSync(join(descriptionsDir, filename), 'utf8').trimEnd()
}

export const READ_DESCRIPTION = loadDescription('read.txt')
export const GLOB_DESCRIPTION = loadDescription('glob.txt')
export const GREP_DESCRIPTION = loadDescription('grep.txt')
export const SEARCH_DESCRIPTION = loadDescription('search.txt')
export const EDIT_DESCRIPTION = loadDescription('edit.txt')
