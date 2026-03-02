import type { EditorView } from 'prosemirror-view'
import type { InlineZoneSession, AIZoneAttrs } from '@plotline/shared'

export type StreamingHandler = (streaming: boolean) => void

export interface AIWriterControllerOptions {
  onStreamingChange?: StreamingHandler
  getIncludeAfterContext?: () => boolean
  getToolScope?: () => { projectId?: string; documentId?: string }
  getRequesterClientName?: () => string | null
  getSessionById?: (sessionId: string) => InlineZoneSession | null
  setSessionById?: (sessionId: string, session: InlineZoneSession | null) => void
}

export type AIZoneNodeAttrs = AIZoneAttrs

export interface ZoneNodePatch {
  streaming?: boolean
  sessionId?: string | null
  originalSlice?: string | null
}

export interface AIWriterController {
  startAIContinuation: (view: EditorView, at_doc_end: boolean) => void
  startAIPromptAtRange: (
    view: EditorView,
    prompt: string,
    selectionFrom: number,
    selectionTo: number
  ) => boolean
  continueAIPromptForZone: (view: EditorView, zoneId: string, prompt: string) => boolean
  dismissChoicesForZone: (view: EditorView, zoneId: string) => boolean
  acceptAI: (view: EditorView, zoneId?: string) => void
  rejectAI: (view: EditorView, zoneId?: string) => void
  cancelAI: (view?: EditorView, options?: { preserveDoc?: boolean }) => void
}

export interface StreamPayload {
  mode: 'continue' | 'prompt'
  contextBefore: string
  contextAfter?: string
  prompt?: string
  selectedText?: string
  conversation?: string
}

export interface PromptStreamPayload extends StreamPayload {
  mode: 'prompt'
  prompt: string
  selectionFrom: number
  selectionTo: number
}
