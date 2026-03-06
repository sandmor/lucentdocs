export const AI_ZONE_CONTROL_LAYOUT_EVENT = 'lucentdocs:ai-zone-control-layout'

export function emitAIZoneControlLayoutChange(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(AI_ZONE_CONTROL_LAYOUT_EVENT))
}
