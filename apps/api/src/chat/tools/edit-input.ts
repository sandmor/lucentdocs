import { getToolLimits } from '../utils.js'
import { EditToolError } from './edit-errors.js'

const RESERVED_MARKUP_PATTERN =
  /<\/?annotation(?:_content)?\b|<\/?document\b|<\/?lines\b|<\/?edit\b|<\/?meta\b/i

const LINE_NUMBER_PREFIX_PATTERN = /^\d+:\s?/

export interface NormalizedEditNeedle {
  text: string
  strippedLineNumbers: boolean
  strippedAnnotationTags: boolean
}

export function normalizeEditNeedle(raw: string): NormalizedEditNeedle {
  const limits = getToolLimits()
  if (raw.length > limits.MAX_TOOL_EDIT_NEEDLE_CHARS) {
    throw new EditToolError(
      'input_too_large',
      `old_string exceeds the maximum length of ${limits.MAX_TOOL_EDIT_NEEDLE_CHARS} characters.`,
      { hint: 'Provide a shorter, more specific passage.' }
    )
  }

  let strippedLineNumbers = false
  let strippedAnnotationTags = false
  let text = raw

  const withoutLineNumbers = text
    .split('\n')
    .map((line) => {
      if (!LINE_NUMBER_PREFIX_PATTERN.test(line)) return line
      strippedLineNumbers = true
      return line.replace(LINE_NUMBER_PREFIX_PATTERN, '')
    })
    .join('\n')
  text = withoutLineNumbers

  const withoutAnnotationContent = text.replace(
    /<annotation_content id="[^"]*">\n?[\s\S]*?\n?<\/annotation_content>\n?/g,
    () => {
      strippedAnnotationTags = true
      return ''
    }
  )
  text = withoutAnnotationContent

  const withoutAnnotationTags = text
    .replace(/<annotation id="[^"]*">\n?/g, () => {
      strippedAnnotationTags = true
      return ''
    })
    .replace(/\n?<\/annotation>/g, () => {
      strippedAnnotationTags = true
      return ''
    })
    .replace(/<annotation id="[^"]*" \/>/g, () => {
      strippedAnnotationTags = true
      return ''
    })
  text = withoutAnnotationTags

  return {
    text,
    strippedLineNumbers,
    strippedAnnotationTags,
  }
}

export function validateEditReplacement(raw: string): string {
  const limits = getToolLimits()
  if (raw.length > limits.MAX_TOOL_EDIT_REPLACEMENT_CHARS) {
    throw new EditToolError(
      'input_too_large',
      `new_string exceeds the maximum length of ${limits.MAX_TOOL_EDIT_REPLACEMENT_CHARS} characters.`,
      { hint: 'Provide a shorter replacement.' }
    )
  }

  if (RESERVED_MARKUP_PATTERN.test(raw)) {
    throw new EditToolError(
      'reserved_markup',
      'new_string must not contain LucentDocs annotation or tool markup tags.',
      { hint: 'Provide manuscript text only.' }
    )
  }

  return raw
}
