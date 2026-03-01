import type { InlineZoneSession } from '@plotline/shared'

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
