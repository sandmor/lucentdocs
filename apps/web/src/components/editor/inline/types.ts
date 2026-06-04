import type { InlineZoneSession } from '@lucentdocs/shared'
import type { InlineSessionPreview } from './inline-session-preview'

export type InlineControlState = 'compose' | 'processing' | 'review'
export type FormatMarkName = 'strong' | 'em' | 'code'
export type AnimationPhase = 'enter' | 'idle' | 'exit'

export interface LoadingAnchor {
  zoneId?: string
  sessionId?: string | null
  from: number
  to: number
  session: InlineZoneSession | null
}

export interface ReviewZone {
  id: string
  sessionId?: string | null
  from: number
  to: number
  streaming: boolean
  session: InlineZoneSession | null
}

export type { InlineSessionPreview }
