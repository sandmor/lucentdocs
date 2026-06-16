import { describe, expect, test } from 'bun:test'
import {
  EDITOR_SIDE_GUTTER_OFFSET,
  computeLeftGutterContainerX,
  computeLeftGutterViewportX,
  computeRightGutterContainerX,
  stackSideElements,
} from './layout'

function rect(left: number, right = left + 200): DOMRect {
  return { left, right } as DOMRect
}

describe('gutter layout', () => {
  test('left gutter positions are editor-relative', () => {
    expect(computeLeftGutterViewportX(rect(200), 40)).toBe(200 - EDITOR_SIDE_GUTTER_OFFSET - 40)
    expect(computeLeftGutterViewportX(rect(100), 10, 20)).toBe(100 - 20 - 10)
    expect(computeLeftGutterContainerX(rect(300), rect(50), 0)).toBe(
      300 - 50 - EDITOR_SIDE_GUTTER_OFFSET
    )
    expect(computeLeftGutterContainerX(rect(300), rect(50), 40)).toBe(
      300 - 50 - EDITOR_SIDE_GUTTER_OFFSET - 40
    )
  })

  test('right gutter positions are editor-relative', () => {
    expect(computeRightGutterContainerX(rect(300, 500), rect(50))).toBe(
      500 - 50 + EDITOR_SIDE_GUTTER_OFFSET
    )
  })
})

describe('stackSideElements', () => {
  test('pushes overlapping items downward', () => {
    const positions = stackSideElements(
      [
        { id: 'a', desiredTop: 10, height: 40 },
        { id: 'b', desiredTop: 20, height: 30 },
        { id: 'c', desiredTop: 100, height: 20 },
      ],
      8
    )

    expect(positions.get('a')).toBe(10)
    expect(positions.get('b')).toBe(58)
    expect(positions.get('c')).toBe(100)
  })
})
