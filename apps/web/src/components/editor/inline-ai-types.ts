import type { AIMode } from './ai-writer-plugin'

export type InlineControlState = 'compose' | 'processing' | 'review'
export type FormatMarkName = 'strong' | 'em'
export type AnimationPhase = 'enter' | 'idle' | 'exit'

export interface LoadingAnchor {
  zoneId?: string
  from: number
  to: number
  mode: AIMode | null
}

export interface ReviewZone {
  id: string
  from: number
  to: number
  mode: AIMode | null
  streaming: boolean
  choices: string[]
}
