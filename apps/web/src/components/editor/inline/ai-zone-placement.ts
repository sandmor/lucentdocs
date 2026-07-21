export interface FloatingRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type AIZonePlacementSide = 'left' | 'right'
export type AIZoneOffscreenDirection = 'above' | 'below' | null

export interface AIZonePlacement {
  x: number
  y: number
  side: AIZonePlacementSide
}

export const AI_ZONE_VIEWPORT_PADDING = 8
export const AI_ZONE_CARD_GAP = 14

export function intersectRects(left: FloatingRect, right: FloatingRect): FloatingRect | null {
  const x1 = Math.max(left.left, right.left)
  const y1 = Math.max(left.top, right.top)
  const x2 = Math.min(left.right, right.right)
  const y2 = Math.min(left.bottom, right.bottom)
  if (x2 <= x1 || y2 <= y1) return null
  return rect(x1, y1, x2 - x1, y2 - y1)
}

export function getOffscreenDirection(
  anchor: FloatingRect,
  viewport: FloatingRect,
  compactThreshold = 8
): AIZoneOffscreenDirection {
  const visible = intersectRects(anchor, viewport)
  if (visible && visible.height >= compactThreshold) return null
  return anchor.bottom <= viewport.top + compactThreshold ? 'above' : 'below'
}

export function placeAIZoneCard({
  anchor,
  viewport,
  editor,
  width,
  height,
  obstacles = [],
  preferredSide,
}: {
  anchor: FloatingRect
  viewport: FloatingRect
  editor: FloatingRect
  width: number
  height: number
  obstacles?: FloatingRect[]
  preferredSide?: AIZonePlacementSide | null
}): AIZonePlacement {
  const visibleAnchor = intersectRects(anchor, viewport) ?? anchor
  const y = clamp(
    visibleAnchor.top + visibleAnchor.height / 2 - height / 2,
    viewport.top,
    Math.max(viewport.top, viewport.bottom - height)
  )
  const horizontalCandidates: AIZonePlacement[] = [
    { x: editor.right + AI_ZONE_CARD_GAP, y, side: 'right' as const },
    { x: editor.left - AI_ZONE_CARD_GAP - width, y, side: 'left' as const },
    { x: viewport.right - width, y, side: 'right' as const },
    { x: viewport.left, y, side: 'left' as const },
  ].map((candidate): AIZonePlacement => ({
    ...candidate,
    x: clamp(candidate.x, viewport.left, Math.max(viewport.left, viewport.right - width)),
  }))

  const sideCandidates = preferredSide
    ? horizontalCandidates.filter((candidate) => candidate.side === preferredSide)
    : horizontalCandidates
  const candidates = sideCandidates.flatMap((candidate) => {
    const nearby = obstacles.filter((obstacle) => {
      const candidateRect = rect(candidate.x, candidate.y, width, height)
      return overlap(candidateRect, obstacle) > 0
    })
    return [
      candidate,
      ...nearby.flatMap((obstacle) => [
        { ...candidate, y: clamp(obstacle.top - height - 8, viewport.top, Math.max(viewport.top, viewport.bottom - height)) },
        { ...candidate, y: clamp(obstacle.bottom + 8, viewport.top, Math.max(viewport.top, viewport.bottom - height)) },
      ]),
    ]
  })

  return [...candidates].sort((a, b) => score(a) - score(b))[0]!

  function score(candidate: AIZonePlacement): number {
    const candidateRect = rect(candidate.x, candidate.y, width, height)
    const obstacleOverlap = obstacles.reduce((sum, obstacle) => sum + overlap(candidateRect, obstacle), 0)
    const editorOverlap = overlap(candidateRect, editor)
    const distance = Math.abs(candidate.x - (anchor.left + anchor.width / 2))
    // Avoid other floating UI first, then document overlap, then prefer the
    // closest side. The tiny right-side bias makes ties deterministic.
    return obstacleOverlap * 10000 + editorOverlap * 10 + distance + (candidate.side === 'right' ? 0 : 0.01)
  }
}

export function rect(left: number, top: number, width: number, height: number): FloatingRect {
  return { left, top, width, height, right: left + width, bottom: top + height }
}

function overlap(left: FloatingRect, right: FloatingRect): number {
  return Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left)) *
    Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
