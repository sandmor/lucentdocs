import type { JsonObject } from './json.js'

export interface DocumentCounters {
  wordCount: number
  charCount: number
  charCountNoSpaces: number
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shouldJoinContentWithoutSeparator(node: JsonObject): boolean {
  return node.type === 'paragraph' || node.type === 'heading'
}

function extractTextFromNode(node: unknown): string {
  if (!isJsonObject(node)) return ''

  // Text node
  if (typeof node.text === 'string') {
    return node.text
  }

  // Hard break → newline
  if (node.type === 'hard_break') {
    return '\n'
  }

  // Container node — recurse into content
  if (Array.isArray(node.content)) {
    return node.content
      .map(extractTextFromNode)
      .join(shouldJoinContentWithoutSeparator(node) ? '' : '\n')
  }

  return ''
}

// Constructed once at module level — Intl.Segmenter is expensive to instantiate.
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' })

const whitespaceRe = /^\p{White_Space}+$/u

export function computeDocumentCounters(proseMirrorDoc: JsonObject): DocumentCounters {
  const text = extractTextFromNode(proseMirrorDoc)

  let charCount = 0
  let charCountNoSpaces = 0
  for (const { segment } of graphemeSegmenter.segment(text)) {
    charCount++
    if (!whitespaceRe.test(segment)) charCountNoSpaces++
  }

  let wordCount = 0
  for (const seg of wordSegmenter.segment(text)) {
    // isWordLike=true covers Latin words, CJK ideographs, emoji, and other script words;
    // punctuation, spaces, and separators are excluded automatically.
    if (seg.isWordLike) wordCount++
  }

  return { wordCount, charCount, charCountNoSpaces }
}
