import { describe, expect, test } from 'bun:test'
import { getOffscreenDirection, placeAIZoneCard, rect } from './ai-zone-placement'

const viewport = rect(0, 0, 1200, 800)
const editor = rect(300, 80, 600, 1400)

describe('AI zone placement', () => {
  test('prefers the nearest clear gutter', () => {
    const placement = placeAIZoneCard({
      anchor: rect(500, 300, 120, 30),
      viewport,
      editor,
      width: 280,
      height: 240,
    })

    expect(placement.side).toBe('right')
    expect(placement.x).toBe(914)
  })

  test('changes sides when the preferred gutter is occupied', () => {
    const placement = placeAIZoneCard({
      anchor: rect(500, 300, 120, 30),
      viewport,
      editor,
      width: 280,
      height: 240,
      obstacles: [rect(914, 150, 280, 500)],
    })

    expect(placement.side).toBe('left')
    expect(placement.x).toBe(6)
  })

  test('clamps a card taller than the usable viewport', () => {
    const placement = placeAIZoneCard({
      anchor: rect(500, 300, 120, 30),
      viewport,
      editor,
      width: 280,
      height: 900,
    })

    expect(placement.y).toBe(0)
  })
})

describe('AI zone offscreen state', () => {
  test('identifies directions and tolerates a visible band', () => {
    expect(getOffscreenDirection(rect(500, -60, 120, 20), viewport)).toBe('above')
    expect(getOffscreenDirection(rect(500, 820, 120, 20), viewport)).toBe('below')
    expect(getOffscreenDirection(rect(500, 790, 120, 30), viewport)).toBe(null)
  })
})
