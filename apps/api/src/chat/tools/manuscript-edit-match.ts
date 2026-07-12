/**
 * Manuscript matching for the edit tool.
 *
 * Documents may contain typographic punctuation (curly quotes, em dashes, NBSP)
 * while models often supply ASCII equivalents in old_string. Matching folds common
 * Unicode variants to canonical forms without changing stored manuscript bytes
 * until replacement is applied.
 *
 * Index mapping always refers to the original manuscript string passed in — never
 * a whole-string NFC recomposition, which would desync UTF-16 offsets for NFD text.
 */

import { manuscriptLineAt } from './document-manuscript.js'

export interface ManuscriptMatchRange {
  start: number
  end: number
}

export interface MatchDiagnostic {
  code: 'not_found'
  nearManuscriptOffset?: number
  nearLine?: number
  excerpt?: string
  hint: string
}

export interface ManuscriptMatchResult {
  ranges: ManuscriptMatchRange[]
  diagnostic?: MatchDiagnostic
}

const MANUSCRIPT_CHAR_FOLD = new Map<number, string>([
  [0x2018, "'"],
  [0x2019, "'"],
  [0x201a, "'"],
  [0x201b, "'"],
  [0x2032, "'"],
  [0x02bc, "'"],
  [0x201c, '"'],
  [0x201d, '"'],
  [0x201e, '"'],
  [0x201f, '"'],
  [0x00ab, '"'],
  [0x00bb, '"'],
  [0x2013, '-'],
  [0x2014, '-'],
  [0x2010, '-'],
  [0x2011, '-'],
  [0x2212, '-'],
  [0x2026, '...'],
  [0x00a0, ' '],
  [0x202f, ' '],
  [0x2007, ' '],
  [0xfeff, ''],
  [0x200b, ''],
  [0x00ad, ''],
])

const graphemeSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

export function foldManuscriptChar(char: string): string {
  const codePoint = char.codePointAt(0)
  if (codePoint === undefined) return char
  const folded = MANUSCRIPT_CHAR_FOLD.get(codePoint)
  if (folded !== undefined) return folded
  return char
}

export function foldManuscriptText(text: string): string {
  return buildFoldedView(text).folded
}

interface FoldedManuscriptView {
  folded: string
  /** folded UTF-16 index -> manuscript UTF-16 start index */
  foldedStartInManuscript: number[]
  /** folded UTF-16 index -> manuscript UTF-16 end index (exclusive) */
  foldedEndInManuscript: number[]
}

function isCombiningMark(codePoint: number): boolean {
  return /\p{M}/u.test(String.fromCodePoint(codePoint))
}

function nextGraphemeClusterEndFallback(text: string, start: number): number {
  const firstCodePoint = text.codePointAt(start)
  if (firstCodePoint === undefined) return start
  let end = start + (firstCodePoint > 0xffff ? 2 : 1)
  while (end < text.length) {
    const codePoint = text.codePointAt(end)
    if (codePoint === undefined || !isCombiningMark(codePoint)) break
    end += codePoint > 0xffff ? 2 : 1
  }
  return end
}

function nextGraphemeClusterEnd(text: string, start: number): number {
  if (graphemeSegmenter) {
    for (const segment of graphemeSegmenter.segment(text)) {
      if (segment.index < start) continue
      return segment.index + segment.segment.length
    }
    return text.length
  }

  return nextGraphemeClusterEndFallback(text, start)
}

function appendFoldedUnits(
  foldedChars: string[],
  foldedStartInManuscript: number[],
  foldedEndInManuscript: number[],
  foldedChar: string,
  originalStart: number,
  originalEnd: number
) {
  if (foldedChar.length === 0) return
  for (let offset = 0; offset < foldedChar.length; offset += 1) {
    foldedChars.push(foldedChar[offset])
    foldedStartInManuscript.push(originalStart)
    foldedEndInManuscript.push(originalEnd)
  }
}

function buildFoldedView(manuscript: string): FoldedManuscriptView {
  const foldedChars: string[] = []
  const foldedStartInManuscript: number[] = []
  const foldedEndInManuscript: number[] = []

  let originalIndex = 0
  while (originalIndex < manuscript.length) {
    if (manuscript[originalIndex] === '\r' && manuscript[originalIndex + 1] === '\n') {
      appendFoldedUnits(
        foldedChars,
        foldedStartInManuscript,
        foldedEndInManuscript,
        '\n',
        originalIndex,
        originalIndex + 2
      )
      originalIndex += 2
      continue
    }

    if (manuscript[originalIndex] === '\r') {
      appendFoldedUnits(
        foldedChars,
        foldedStartInManuscript,
        foldedEndInManuscript,
        '\n',
        originalIndex,
        originalIndex + 1
      )
      originalIndex += 1
      continue
    }

    const clusterEnd = nextGraphemeClusterEnd(manuscript, originalIndex)
    const cluster = manuscript.slice(originalIndex, clusterEnd)
    const nfcCluster = cluster.normalize('NFC')

    let nfcIndex = 0
    while (nfcIndex < nfcCluster.length) {
      const codePoint = nfcCluster.codePointAt(nfcIndex)
      if (codePoint === undefined) break
      const char = String.fromCodePoint(codePoint)
      const foldedChar = foldManuscriptChar(char)
      appendFoldedUnits(
        foldedChars,
        foldedStartInManuscript,
        foldedEndInManuscript,
        foldedChar,
        originalIndex,
        clusterEnd
      )
      nfcIndex += char.length
    }

    originalIndex = clusterEnd
  }

  return {
    folded: foldedChars.join(''),
    foldedStartInManuscript,
    foldedEndInManuscript,
  }
}

function foldNeedleLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

function buildFoldedNeedle(needle: string): string {
  const lineNormalized = foldNeedleLineEndings(needle)
  const foldedChars: string[] = []

  let needleIndex = 0
  while (needleIndex < lineNormalized.length) {
    const clusterEnd = nextGraphemeClusterEnd(lineNormalized, needleIndex)
    const cluster = lineNormalized.slice(needleIndex, clusterEnd).normalize('NFC')

    let nfcIndex = 0
    while (nfcIndex < cluster.length) {
      const codePoint = cluster.codePointAt(nfcIndex)
      if (codePoint === undefined) break
      const char = String.fromCodePoint(codePoint)
      const foldedChar = foldManuscriptChar(char)
      if (foldedChar.length > 0) {
        for (const unit of foldedChar) {
          foldedChars.push(unit)
        }
      }
      nfcIndex += char.length
    }

    needleIndex = clusterEnd
  }

  return foldedChars.join('')
}

function rangesEqual(left: ManuscriptMatchRange, right: ManuscriptMatchRange): boolean {
  return left.start === right.start && left.end === right.end
}

export function findManuscriptMatchRanges(
  manuscript: string,
  needle: string
): ManuscriptMatchRange[] {
  if (needle.length === 0) return []

  const view = buildFoldedView(manuscript)
  const foldedNeedle = buildFoldedNeedle(needle)
  if (foldedNeedle.length === 0) return []

  const ranges: ManuscriptMatchRange[] = []
  let searchFrom = 0

  while (searchFrom <= view.folded.length - foldedNeedle.length) {
    const index = view.folded.indexOf(foldedNeedle, searchFrom)
    if (index === -1) break

    const endIndex = index + foldedNeedle.length - 1
    const range = {
      start: view.foldedStartInManuscript[index],
      end: view.foldedEndInManuscript[endIndex],
    }
    if (!ranges.some((existing) => rangesEqual(existing, range))) {
      ranges.push(range)
    }

    searchFrom = index + foldedNeedle.length
  }

  return ranges
}

function buildMatchDiagnostic(manuscript: string, needle: string): MatchDiagnostic {
  const view = buildFoldedView(manuscript)
  const foldedNeedle = buildFoldedNeedle(needle)
  const firstLine = foldedNeedle.split('\n')[0] ?? foldedNeedle

  let nearFoldedIndex = -1
  for (let length = Math.min(24, firstLine.length); length >= 4; length -= 1) {
    const prefix = firstLine.slice(0, length)
    const index = view.folded.indexOf(prefix)
    if (index !== -1) {
      nearFoldedIndex = index
      break
    }
  }

  if (nearFoldedIndex !== -1) {
    const nearManuscriptOffset = view.foldedStartInManuscript[nearFoldedIndex]
    const nearLine = manuscriptLineAt(manuscript, nearManuscriptOffset)
    const excerptStart = Math.max(0, nearManuscriptOffset - 20)
    const excerptEnd = Math.min(manuscript.length, nearManuscriptOffset + 60)
    return {
      code: 'not_found',
      nearManuscriptOffset,
      nearLine,
      excerpt: manuscript.slice(excerptStart, excerptEnd),
      hint: 'Re-read the file and copy the target passage without line numbers or <annotation> tags.',
    }
  }

  return {
    code: 'not_found',
    hint: 'Re-read the file and copy the target passage from the latest read output without line numbers or <annotation> tags.',
  }
}

export function matchManuscript(manuscript: string, needle: string): ManuscriptMatchResult {
  const ranges = findManuscriptMatchRanges(manuscript, needle)
  if (ranges.length > 0) {
    return { ranges }
  }

  return {
    ranges,
    diagnostic: buildMatchDiagnostic(manuscript, needle),
  }
}

export function describeManuscriptMatchFailure(manuscript: string, needle: string): string {
  const diagnostic = buildMatchDiagnostic(manuscript, needle)
  if (diagnostic.nearManuscriptOffset !== undefined && diagnostic.nearLine !== undefined) {
    return `old_string not found in content. A similar passage starts near line ${diagnostic.nearLine} (manuscript offset ${diagnostic.nearManuscriptOffset}); re-read the file and copy the passage exactly (without line numbers or <annotation> tags).`
  }

  return diagnostic.hint
    ? `old_string not found in content. ${diagnostic.hint}`
    : 'old_string not found in content.'
}

export function replaceManuscriptMatches(
  manuscript: string,
  needle: string,
  replacement: string,
  options: { replaceAll: boolean }
): { nextManuscript: string; replacements: number } {
  const ranges = findManuscriptMatchRanges(manuscript, needle)
  if (ranges.length === 0) {
    return { nextManuscript: manuscript, replacements: 0 }
  }

  const selected = options.replaceAll ? ranges : [ranges[0]]
  const ordered = [...selected].sort((left, right) => right.start - left.start)
  let nextManuscript = manuscript
  for (const range of ordered) {
    nextManuscript =
      nextManuscript.slice(0, range.start) + replacement + nextManuscript.slice(range.end)
  }

  return { nextManuscript, replacements: selected.length }
}
