import { describe, expect, test } from 'bun:test'
import {
  EDITOR_SIDE_GUTTER_OFFSET,
  computeLeftGutterContainerX,
  computeLeftGutterViewportX,
} from './layout'

function rect(left: number): DOMRect {
  return { left } as DOMRect
}

describe('computeLeftGutterViewportX', () => {
  test('places element right edge offset px left of editor content', () => {
    expect(computeLeftGutterViewportX(rect(200), 40)).toBe(
      200 - EDITOR_SIDE_GUTTER_OFFSET - 40
    )
  })

  test('respects custom offset', () => {
    expect(computeLeftGutterViewportX(rect(100), 10, 20)).toBe(100 - 20 - 10)
  })
})

describe('computeLeftGutterContainerX', () => {
  test('matches legacy search marker left when element width is zero', () => {
    expect(computeLeftGutterContainerX(rect(300), rect(50), 0)).toBe(
      300 - 50 - EDITOR_SIDE_GUTTER_OFFSET
    )
  })

  test('offsets by element width for wider gutter controls', () => {
    expect(computeLeftGutterContainerX(rect(300), rect(50), 40)).toBe(
      300 - 50 - EDITOR_SIDE_GUTTER_OFFSET - 40
    )
  })
})
