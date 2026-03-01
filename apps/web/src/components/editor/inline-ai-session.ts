export interface InlineToolChip {
  toolName: string
  state: 'pending' | 'complete'
}

export interface InlineChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  tools: InlineToolChip[]
}

export interface InlineZoneSession {
  messages: InlineChatMessage[]
  choices: string[]
  contextBefore: string | null
  contextAfter: string | null
}
