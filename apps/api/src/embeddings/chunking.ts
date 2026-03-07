/**
 * Text chunking for embeddings.
 *
 * This module splits text into chunks suitable for embedding, supporting three
 * granularity levels: character, sentence, and paragraph.
 *
 * ## Algorithm Overview
 *
 * The chunking process follows a three-phase pipeline:
 *
 * 1. Unit Building: Segment text into units based on the chosen level
 *    - Character: individual grapheme clusters (unicode-aware)
 *    - Sentence: sentence boundaries (via Intl.Segmenter)
 *    - Paragraph: blocks separated by 2+ newlines
 *
 * 2. Unit Normalization: Ensure each unit satisfies length constraints
 *    - Merge: Combine consecutive short units until minUnitChars is reached
 *    - Split: Break oversized units (sentences→graphemes, paragraphs→sentences→graphemes)
 *
 * 3. Windowing: Assemble normalized units into overlapping windows
 *    - windowSize: number of units per window
 *    - stride: units to advance between windows
 *
 * ## Length Constraints
 *
 * minUnitChars and maxUnitChars apply to individual units, not windows. This ensures
 * predictable chunk sizes regardless of window configuration. After normalization,
 * windows are assembled by simply combining consecutive units.
 */
import type { IndexingStrategy } from '@lucentdocs/shared'

/**
 * A chunk of text ready for embedding.
 */
export interface EmbeddingChunk {
  ordinal: number
  start: number
  end: number
  text: string
}

/**
 * A range within the document, expressed in grapheme indices.
 */
interface ChunkRange {
  start: number
  end: number
}

/**
 * Configuration for structured chunking (sentence/paragraph level).
 */
interface StructuredChunkConfig {
  /** Pre-built units (sentences or paragraphs) as grapheme ranges */
  units: ChunkRange[]
  /** Number of units to include in each window */
  windowSize: number
  /** Number of units to advance between windows */
  stride: number
  /** Minimum length in graphemes for a single unit */
  minUnitChars: number
  /** Maximum length in graphemes for a single unit */
  maxUnitChars: number
  /** Granularity level for splitting oversized units */
  level: 'sentence' | 'paragraph'
  /** Array of all graphemes in the document */
  graphemes: string[]
  /** Maps code unit offsets to grapheme indices */
  codeUnitToGrapheme: Map<number, number>
}

/**
 * Preprocessed text data with grapheme-level indexing.
 */
interface GraphemeData {
  /** All graphemes in the document as an array */
  graphemes: string[]
  /** Maps code unit offsets to grapheme indices for range conversion */
  codeUnitToGrapheme: Map<number, number>
}

/**
 * Segments text into grapheme clusters and builds a code unit to grapheme index map.
 *
 * This enables unicode-aware chunking where multi-code-unit characters (emoji,
 * combining marks, etc.) are treated as single units.
 */
function prepareGraphemeData(text: string): GraphemeData {
  const graphemes: string[] = []
  const codeUnitToGrapheme = new Map<number, number>()
  codeUnitToGrapheme.set(0, 0)

  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  let codeUnitOffset = 0
  let graphemeIndex = 0

  for (const segment of segmenter.segment(text)) {
    graphemes.push(segment.segment)
    codeUnitOffset += segment.segment.length
    graphemeIndex += 1
    codeUnitToGrapheme.set(codeUnitOffset, graphemeIndex)
  }

  return { graphemes, codeUnitToGrapheme }
}

/**
 * Converts a code unit offset to a grapheme index using the precomputed map.
 */
function toGraphemeIndex(map: Map<number, number>, value: number): number {
  const resolved = map.get(value)
  if (resolved !== undefined) {
    return resolved
  }

  throw new Error(`Unable to resolve grapheme index for code unit offset ${value}.`)
}

/**
 * Creates an EmbeddingChunk from a grapheme range.
 */
function createChunk(
  graphemes: string[],
  ordinal: number,
  start: number,
  end: number
): EmbeddingChunk {
  const text = graphemes.slice(start, end).join('')
  return {
    ordinal,
    start,
    end,
    text,
  }
}

/**
 * Creates a single chunk containing the entire document.
 * Returns empty array if the document is whitespace-only.
 */
function createWholeDocumentChunk(graphemes: string[]): EmbeddingChunk[] {
  const chunk = createChunk(graphemes, 0, 0, graphemes.length)
  return chunk.text.trim() ? [chunk] : []
}

/**
 * Returns the length of a range in graphemes.
 */
function rangeLength(range: ChunkRange): number {
  return range.end - range.start
}

/**
 * Segments text into sentences using Intl.Segmenter.
 * Returns grapheme ranges for each sentence.
 * Falls back to a single range covering the entire document if no sentences found.
 */
function buildSentenceRanges(
  text: string,
  codeUnitToGrapheme: Map<number, number>,
  totalGraphemes: number
): ChunkRange[] {
  if (!text) return []

  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })
  const ranges: ChunkRange[] = []

  for (const segment of segmenter.segment(text)) {
    if (!segment.segment) continue
    const start = toGraphemeIndex(codeUnitToGrapheme, segment.index)
    const end = toGraphemeIndex(codeUnitToGrapheme, segment.index + segment.segment.length)
    if (end > start) {
      ranges.push({ start, end })
    }
  }

  return ranges.length > 0 ? ranges : [{ start: 0, end: totalGraphemes }]
}

/**
 * Segments text into paragraphs by splitting on 2+ consecutive newlines.
 * Returns grapheme ranges for each paragraph.
 * Falls back to a single range covering the entire document if no paragraphs found.
 */
function buildParagraphRanges(
  text: string,
  codeUnitToGrapheme: Map<number, number>,
  totalGraphemes: number
): ChunkRange[] {
  if (!text) return []

  const delimiterPattern = /\n{2,}/g
  const ranges: ChunkRange[] = []
  let startCodeUnit = 0

  for (const match of text.matchAll(delimiterPattern)) {
    const delimiterStart = match.index ?? 0
    if (delimiterStart > startCodeUnit) {
      ranges.push({
        start: toGraphemeIndex(codeUnitToGrapheme, startCodeUnit),
        end: toGraphemeIndex(codeUnitToGrapheme, delimiterStart),
      })
    }

    startCodeUnit = delimiterStart + match[0].length
  }

  if (startCodeUnit < text.length) {
    ranges.push({
      start: toGraphemeIndex(codeUnitToGrapheme, startCodeUnit),
      end: toGraphemeIndex(codeUnitToGrapheme, text.length),
    })
  }

  return ranges.length > 0 ? ranges : [{ start: 0, end: totalGraphemes }]
}

/**
 * Splits a range into multiple chunks of at most maxChars graphemes each.
 *
 * This is the final fallback for oversized units when no finer semantic
 * boundaries are available. Used for splitting oversized sentences.
 */
function splitRangeByGraphemes(range: ChunkRange, maxChars: number): ChunkRange[] {
  const length = rangeLength(range)
  if (length <= maxChars) {
    return [range]
  }

  const result: ChunkRange[] = []
  let current = range.start

  while (current < range.end) {
    const chunkEnd = Math.min(current + maxChars, range.end)
    result.push({ start: current, end: chunkEnd })
    current = chunkEnd
  }

  return result
}

/**
 * Splits an oversized paragraph range by sentence boundaries.
 *
 * For each sentence in the paragraph:
 * - If it fits within maxChars, use it as-is
 * - If it exceeds maxChars, fall back to grapheme-based splitting
 *
 * This preserves sentence boundaries when possible while ensuring no chunk
 * exceeds maxChars. Used only for paragraph-level chunking.
 */
function splitRangeBySentences(
  range: ChunkRange,
  maxChars: number,
  graphemes: string[],
  codeUnitToGrapheme: Map<number, number>
): ChunkRange[] {
  const length = rangeLength(range)
  if (length <= maxChars) {
    return [range]
  }

  const paragraphText = graphemes.slice(range.start, range.end).join('')
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })
  const result: ChunkRange[] = []

  for (const segment of segmenter.segment(paragraphText)) {
    if (!segment.segment) continue

    const paragraphStartCodeUnit = graphemes.slice(0, range.start).join('').length
    const sentenceStartCodeUnit = paragraphStartCodeUnit + segment.index
    const sentenceEndCodeUnit = sentenceStartCodeUnit + segment.segment.length

    const sentenceStart = toGraphemeIndex(codeUnitToGrapheme, sentenceStartCodeUnit)
    const sentenceEnd = toGraphemeIndex(codeUnitToGrapheme, sentenceEndCodeUnit)

    const sentenceRange: ChunkRange = { start: sentenceStart, end: sentenceEnd }
    const sentenceLength = rangeLength(sentenceRange)

    if (sentenceLength <= maxChars) {
      result.push(sentenceRange)
    } else {
      result.push(...splitRangeByGraphemes(sentenceRange, maxChars))
    }
  }

  return result.length > 0 ? result : splitRangeByGraphemes(range, maxChars)
}

/**
 * Normalizes units to satisfy minChars and maxChars constraints.
 *
 * This is a two-phase process:
 *
 * ## Phase 1: Merge
 * Greedily combines consecutive units until each reaches minChars.
 * Units are merged forward, so a short unit absorbs the next one.
 * The final unit may be below minChars if there are no more units to merge.
 *
 * ## Phase 2: Split
 * Breaks units that exceed maxChars. The strategy depends on level:
 * - Sentence level: Split by graphemes directly (no finer boundaries)
 * - Paragraph level: Split by sentences first, then graphemes if needed
 *
 * The order matters: merge first, then split. This means a merged unit that
 * exceeds maxChars will be split back into valid-sized chunks.
 *
 * @param units - Initial unit ranges from segmentation
 * @param minChars - Target minimum length in graphemes per unit
 * @param maxChars - Hard maximum length in graphemes per unit
 * @param level - Granularity level (affects splitting strategy)
 * @param graphemes - All document graphemes for text extraction
 * @returns Normalized unit ranges
 */
function normalizeUnits(
  units: ChunkRange[],
  minChars: number,
  maxChars: number,
  level: 'sentence' | 'paragraph',
  graphemes: string[],
  codeUnitToGrapheme: Map<number, number>
): ChunkRange[] {
  if (units.length === 0) return []

  const merged: ChunkRange[] = []

  for (let i = 0; i < units.length; i++) {
    const current = { ...units[i]! }

    while (rangeLength(current) < minChars && i + 1 < units.length) {
      i += 1
      current.end = units[i]!.end
    }

    merged.push(current)
  }

  const result: ChunkRange[] = []

  for (const unit of merged) {
    if (rangeLength(unit) > maxChars) {
      if (level === 'sentence') {
        result.push(...splitRangeByGraphemes(unit, maxChars))
      } else {
        result.push(...splitRangeBySentences(unit, maxChars, graphemes, codeUnitToGrapheme))
      }
    } else {
      result.push(unit)
    }
  }

  return result
}

/**
 * Combines consecutive units into a single range.
 * Used during windowing to build window ranges from unit ranges.
 */
function buildRangeFromUnits(
  units: ChunkRange[],
  startIndex: number,
  endIndex: number
): ChunkRange {
  return {
    start: units[startIndex]!.start,
    end: units[endIndex - 1]!.end,
  }
}

/**
 * Removes duplicate ranges from an array.
 * Ranges are duplicates if they have identical start and end values.
 */
function dedupeRanges(ranges: ChunkRange[]): ChunkRange[] {
  const deduped: ChunkRange[] = []

  for (const range of ranges) {
    const previous = deduped[deduped.length - 1]
    if (previous && previous.start === range.start && previous.end === range.end) {
      continue
    }

    deduped.push(range)
  }

  return deduped
}

/**
 * Builds embedding chunks from structured text (sentences or paragraphs).
 *
 * Processing pipeline:
 * 1. Normalize units to satisfy length constraints
 * 2. Slide a window across normalized units to create overlapping chunks
 * 3. Deduplicate and filter empty chunks
 *
 * @param graphemes - All graphemes in the document
 * @param config - Chunking configuration including units, window, and constraints
 * @returns Array of embedding chunks
 */
function buildStructuredChunks(
  graphemes: string[],
  config: StructuredChunkConfig
): EmbeddingChunk[] {
  if (config.units.length === 0) {
    return createWholeDocumentChunk(graphemes)
  }

  const normalizedUnits = normalizeUnits(
    config.units,
    config.minUnitChars,
    config.maxUnitChars,
    config.level,
    config.graphemes,
    config.codeUnitToGrapheme
  )

  if (normalizedUnits.length === 0) {
    return createWholeDocumentChunk(graphemes)
  }

  const ranges: ChunkRange[] = []

  for (let startIndex = 0; startIndex < normalizedUnits.length; startIndex += config.stride) {
    const endIndex = Math.min(normalizedUnits.length, startIndex + config.windowSize)
    ranges.push(buildRangeFromUnits(normalizedUnits, startIndex, endIndex))

    if (endIndex >= normalizedUnits.length) {
      break
    }
  }

  return dedupeRanges(ranges)
    .filter((range) => range.end > range.start)
    .map((range, ordinal) => createChunk(graphemes, ordinal, range.start, range.end))
    .filter((chunk) => chunk.text.trim())
}

/**
 * Main entry point for building embedding chunks from text.
 *
 * Supports three chunking strategies:
 * - whole_document: Returns a single chunk containing all text
 * - character: Simple sliding window over graphemes (no min/max constraints)
 * - sentence/paragraph: Structured chunking with unit-level min/max constraints
 *
 * @param text - The document text to chunk
 * @param strategy - Chunking strategy configuration
 * @returns Array of embedding chunks with text and position metadata
 */
export function buildEmbeddingChunks(text: string, strategy: IndexingStrategy): EmbeddingChunk[] {
  if (!text) return []

  const { graphemes, codeUnitToGrapheme } = prepareGraphemeData(text)
  const totalGraphemes = graphemes.length

  if (totalGraphemes === 0) return []

  if (strategy.type === 'whole_document') {
    return createWholeDocumentChunk(graphemes)
  }

  if (strategy.properties.level === 'character') {
    if (totalGraphemes <= strategy.properties.windowSize) {
      return createWholeDocumentChunk(graphemes)
    }

    const { windowSize, stride } = strategy.properties
    const chunks: EmbeddingChunk[] = []

    for (let start = 0, ordinal = 0; start < totalGraphemes; start += stride, ordinal += 1) {
      const end = Math.min(totalGraphemes, start + windowSize)
      const chunk = createChunk(graphemes, ordinal, start, end)
      if (chunk.text) {
        chunks.push(chunk)
      }

      if (end >= totalGraphemes) {
        break
      }
    }

    return chunks
  }

  if (strategy.properties.level === 'sentence') {
    return buildStructuredChunks(graphemes, {
      units: buildSentenceRanges(text, codeUnitToGrapheme, totalGraphemes),
      windowSize: strategy.properties.windowSize,
      stride: strategy.properties.stride,
      minUnitChars: strategy.properties.minUnitChars,
      maxUnitChars: strategy.properties.maxUnitChars,
      level: 'sentence',
      graphemes,
      codeUnitToGrapheme,
    })
  }

  return buildStructuredChunks(graphemes, {
    units: buildParagraphRanges(text, codeUnitToGrapheme, totalGraphemes),
    windowSize: strategy.properties.windowSize,
    stride: strategy.properties.stride,
    minUnitChars: strategy.properties.minUnitChars,
    maxUnitChars: strategy.properties.maxUnitChars,
    level: 'paragraph',
    graphemes,
    codeUnitToGrapheme,
  })
}
