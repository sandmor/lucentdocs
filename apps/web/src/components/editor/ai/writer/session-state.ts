import type { InlineZoneSession } from '@lucentdocs/shared'

export function createEmptySession(): InlineZoneSession {
  return {
    messages: [],
    choices: [],
    contextBefore: null,
    contextAfter: null,
    contextTruncated: false,
  }
}
