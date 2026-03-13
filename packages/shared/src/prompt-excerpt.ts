export interface ExcerptPart {
  text: string
  truncated: boolean
}

/**
 * The kind of cursor-position marker embedded in a prompt context excerpt.
 * Serialisation to XML is deferred until {@link renderContextParts} is called.
 */
export type ContextMarkerKind = 'caret' | 'selection'

/**
 * Structured representation of a budget-constrained prompt context excerpt.
 * The marker is kept as raw data so that XML serialisation only happens at the
 * final template-variable building step via {@link renderContextParts}.
 */
export interface ContextParts {
  /** Text before the marker (may include a truncation-notice prefix when truncated). */
  before: string
  markerKind: ContextMarkerKind
  /** Raw selection text for 'selection'; empty string for 'caret'. */
  markerContent: string
  /** Text after the marker, or undefined when there is no trailing context. */
  after: string | undefined
  truncated: boolean
  truncatedBefore: boolean
  truncatedAfter: boolean
  /** True when selection content was clipped to satisfy the budget. */
  truncatedMarker: boolean
}

// Serialised lengths of the marker envelope — used for budget calculations.
const CARET_SERIALIZED_LENGTH = '<caret />'.length // 9
const SELECTION_WRAPPER_LENGTH = '<selection></selection>'.length // 23

const OMISSION_EARLIER = '<omitted content="earlier"/>'
const OMISSION_MIDDLE = '<omitted content="middle"/>'
const OMISSION_LATER = '<omitted content="later"/>'
const TRUNCATION_NOTICE =
  '<truncation_notice>The full file is larger; more context is omitted.</truncation_notice>'
const TRUNCATION_NOTICE_PREFIX = `${TRUNCATION_NOTICE}\n`

export const DEFAULT_PROMPT_EXCERPT_CHARS = 12_000
export const MIN_PROMPT_EXCERPT_CHARS = 256

function normalizeExcerptBudget(budget: number): number {
  if (!Number.isFinite(budget)) {
    return DEFAULT_PROMPT_EXCERPT_CHARS
  }

  return Math.max(MIN_PROMPT_EXCERPT_CHARS, Math.floor(budget))
}

function buildBoundedSideExcerpt(
  text: string,
  maxChars: number,
  options: { omission: string; keep: 'head' | 'tail' }
): ExcerptPart {
  const normalizedMaxChars = Math.max(0, Math.floor(maxChars))
  if (text.length <= normalizedMaxChars) {
    return { text, truncated: false }
  }

  if (normalizedMaxChars === 0) {
    return { text: '', truncated: text.length > 0 }
  }

  const omissionPrefix = `${options.omission}\n`
  if (normalizedMaxChars <= omissionPrefix.length) {
    return {
      text: omissionPrefix.slice(0, normalizedMaxChars),
      truncated: true,
    }
  }

  const visibleChars = normalizedMaxChars - omissionPrefix.length
  const visibleText =
    options.keep === 'tail'
      ? text.slice(text.length - visibleChars).trimStart()
      : text.slice(0, visibleChars).trimEnd()

  return {
    text:
      options.keep === 'tail'
        ? `${options.omission}\n${visibleText}`
        : `${visibleText}\n${options.omission}`,
    truncated: true,
  }
}

export function takeTailExcerpt(text: string, maxChars: number): ExcerptPart {
  return buildBoundedSideExcerpt(text, maxChars, {
    omission: OMISSION_EARLIER,
    keep: 'tail',
  })
}

export function takeHeadExcerpt(text: string, maxChars: number): ExcerptPart {
  return buildBoundedSideExcerpt(text, maxChars, {
    omission: OMISSION_LATER,
    keep: 'head',
  })
}

export function clipMiddleExcerpt(text: string, maxChars: number): ExcerptPart {
  const normalizedMaxChars = Math.max(0, Math.floor(maxChars))
  if (text.length <= normalizedMaxChars) {
    return { text, truncated: false }
  }

  if (normalizedMaxChars === 0) {
    return { text: '', truncated: text.length > 0 }
  }

  if (normalizedMaxChars <= OMISSION_MIDDLE.length) {
    return {
      text: OMISSION_MIDDLE.slice(0, normalizedMaxChars),
      truncated: true,
    }
  }

  const remainingChars = Math.max(0, normalizedMaxChars - OMISSION_MIDDLE.length)
  const headChars = Math.ceil(remainingChars / 2)
  const tailChars = Math.floor(remainingChars / 2)

  return {
    text: `${text.slice(0, headChars).trimEnd()}${OMISSION_MIDDLE}${text.slice(text.length - tailChars).trimStart()}`,
    truncated: true,
  }
}

/**
 * Serialises a {@link ContextParts} value to its final XML form, ready to be
 * placed into a prompt template variable.  This is the only site in the
 * codebase where `<selection>…</selection>` and `<caret />` are written as
 * literal strings.
 */
export function renderContextParts(parts: ContextParts): string {
  const marker =
    parts.markerKind === 'selection' ? `<selection>${parts.markerContent}</selection>` : '<caret />'
  return parts.before + marker + (parts.after ?? '')
}

/**
 * Budget-constrained context extraction.
 *
 * Accepts the marker as structured data (kind + raw content) rather than a
 * pre-serialised XML string.  Clipping of selection content is performed on
 * the raw text so there is no need to re-parse XML tags.  Call
 * {@link renderContextParts} on the result when the final template-variable
 * string is needed.
 */
export function buildBoundedExcerpt(
  before: string,
  markerKind: ContextMarkerKind,
  markerContent: string,
  after: string | undefined,
  budget: number
): ContextParts {
  const normalizedBudget = normalizeExcerptBudget(budget)
  const safeAfter = after ?? ''

  // ---- Clip selection content to a portion of the total budget ---------------
  let effectiveMarkerContent = markerContent
  let markerExcerpt: ExcerptPart | null = null

  if (markerKind === 'selection') {
    const serializedLen = markerContent.length + SELECTION_WRAPPER_LENGTH
    const markerBudget = Math.min(
      normalizedBudget,
      Math.max(Math.floor(normalizedBudget * 0.55), Math.min(serializedLen, 256))
    )
    const innerBudget = Math.max(0, markerBudget - SELECTION_WRAPPER_LENGTH)
    if (markerContent.length > innerBudget) {
      markerExcerpt = clipMiddleExcerpt(markerContent, innerBudget)
      effectiveMarkerContent = markerExcerpt.text
    }
  }
  // Caret is a tiny constant — it never needs clipping.

  const effectiveSerializedLen =
    effectiveMarkerContent.length +
    (markerKind === 'selection' ? SELECTION_WRAPPER_LENGTH : CARET_SERIALIZED_LENGTH)
  const initialContextBudget = Math.max(0, normalizedBudget - effectiveSerializedLen)

  const beforeLen = before.length
  const afterLen = safeAfter.length

  if (!markerExcerpt?.truncated && beforeLen + afterLen <= initialContextBudget) {
    return {
      before,
      markerKind,
      markerContent: effectiveMarkerContent,
      after,
      truncated: false,
      truncatedBefore: false,
      truncatedAfter: false,
      truncatedMarker: false,
    }
  }

  // ---- Both sides need truncation; re-clip marker under total budget ----------
  const markerWrapperLen =
    markerKind === 'selection' ? SELECTION_WRAPPER_LENGTH : CARET_SERIALIZED_LENGTH
  const maxMarkerInnerChars = Math.max(
    0,
    normalizedBudget - TRUNCATION_NOTICE_PREFIX.length - markerWrapperLen
  )
  if (markerKind === 'selection' && effectiveMarkerContent.length > maxMarkerInnerChars) {
    markerExcerpt = clipMiddleExcerpt(markerContent, maxMarkerInnerChars)
    effectiveMarkerContent = markerExcerpt.text
  }

  const finalSerializedLen = effectiveMarkerContent.length + markerWrapperLen
  const remainingBudget = Math.max(
    0,
    normalizedBudget - TRUNCATION_NOTICE_PREFIX.length - finalSerializedLen
  )
  const halfBudget = Math.floor(remainingBudget / 2)

  let beforeExcerpt: ExcerptPart
  let afterExcerpt: ExcerptPart

  if (beforeLen <= halfBudget) {
    beforeExcerpt = { text: before, truncated: false }
    afterExcerpt = takeHeadExcerpt(safeAfter, remainingBudget - beforeLen)
  } else if (afterLen <= halfBudget) {
    afterExcerpt = { text: safeAfter, truncated: false }
    beforeExcerpt = takeTailExcerpt(before, remainingBudget - afterLen)
  } else {
    beforeExcerpt = takeTailExcerpt(before, halfBudget)
    afterExcerpt = takeHeadExcerpt(safeAfter, halfBudget)
  }

  return {
    before: `${TRUNCATION_NOTICE_PREFIX}${beforeExcerpt.text}`,
    markerKind,
    markerContent: effectiveMarkerContent,
    after: afterExcerpt.text || undefined,
    truncated: true,
    truncatedBefore: beforeExcerpt.truncated,
    truncatedAfter: afterExcerpt.truncated,
    truncatedMarker: markerExcerpt?.truncated ?? false,
  }
}

/**
 * Convenience wrapper around {@link buildBoundedExcerpt}.
 *
 * Marker serialisation is still deferred — call {@link renderContextParts} on
 * the result when the final template-variable string is required.
 */
export function buildPromptContextExcerpt(
  contextBefore: string,
  markerKind: ContextMarkerKind,
  markerContent: string,
  contextAfter: string | undefined,
  budget: number
): ContextParts {
  return buildBoundedExcerpt(contextBefore, markerKind, markerContent, contextAfter, budget)
}
