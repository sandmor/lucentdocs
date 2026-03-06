import type { InlineZoneSession } from '@lucentdocs/shared'

export function createEmptySession(): InlineZoneSession {
  return {
    messages: [],
    choices: [],
    contextBefore: null,
    contextAfter: null,
  }
}

export function createSessionWithPromptContext(
  contextBefore: string,
  contextAfter: string | null
): InlineZoneSession {
  return {
    messages: [],
    choices: [],
    contextBefore,
    contextAfter,
  }
}
