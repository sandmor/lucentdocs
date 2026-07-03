import { describe, expect, test } from 'bun:test'
import { computeNoteGutterDesiredTop } from './note-anchor'

describe('computeNoteGutterDesiredTop', () => {
  test('centers orb on anchor region shorter than the orb', () => {
    const anchor = {
      anchorId: 'block-1',
      anchorKind: 'block' as const,
      pos: 1,
      top: 100,
      height: 24,
      orphan: false,
    }

    expect(
      computeNoteGutterDesiredTop(anchor, {
        containerTop: 0,
        orbSize: 40,
      })
    ).toBe(92)
  })
})
