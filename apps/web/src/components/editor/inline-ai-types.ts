import type { InlineZoneSession } from './inline-ai-session'

export type InlineControlState = 'compose' | 'processing' | 'review'
export type FormatMarkName = 'strong' | 'em'
export type AnimationPhase = 'enter' | 'idle' | 'exit'

export interface LoadingAnchor {
  zoneId?: string
  from: number
  to: number
  session: InlineZoneSession | null
}

export interface ReviewZone {
  id: string
  from: number
  to: number
  streaming: boolean
  session: InlineZoneSession | null
}
