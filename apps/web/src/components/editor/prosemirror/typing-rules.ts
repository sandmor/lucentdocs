import { InputRule, undoInputRule } from 'prosemirror-inputrules'
import { type Command } from 'prosemirror-state'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import type { MarkType, Schema } from 'prosemirror-model'
import { schema } from '@lucentdocs/shared'

/** The user-facing name is Divider; Markdown and ProseMirror call this an HR. */
function dividerRule(): InputRule {
  return new InputRule(/^(---|\*\*\*|___)$/, (state, _match, start, end) => {
    const hr = schema.nodes.horizontal_rule
    const paragraph = schema.nodes.paragraph
    if (!hr || !paragraph) return null
    const $start = state.doc.resolve(start)
    const parent = $start.parent
    if (parent.type !== paragraph || parent.content.size !== end - start) return null

    const sourceId = typeof parent.attrs.id === 'string' ? parent.attrs.id : null
    const tr = state.tr.replaceWith($start.before(), $start.after(), [
      hr.create({ id: sourceId }),
      paragraph.create(),
    ])
    return tr.setSelection(TextSelection.create(tr.doc, start + 1))
  })
}

function inlineMarkRule(pattern: RegExp, markType: MarkType, delimiterLength: number): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const text = match[1]
    if (!text || /^\s|\s$/.test(text)) return null

    // `end` only covers document content that already exists. During ordinary
    // typing the final delimiter is still in the browser input event, whereas
    // after composition it is already in the document. Replacing the entire
    // existing syntax range with the captured text works in both cases.
    const textStart = start + match[0].indexOf(text)
    const replacementStart = textStart - delimiterLength
    const tr = state.tr.insertText(text, replacementStart, end)
    const replacementEnd = replacementStart + text.length
    tr.addMark(replacementStart, replacementEnd, markType.create())
    tr.setSelection(TextSelection.create(tr.doc, replacementEnd))
    tr.removeStoredMark(markType)
    return tr
  })
}

function inlineMathRule(editorSchema: Schema): InputRule {
  return new InputRule(/(?<![\\$])\$([^$\n]+)\$$/, (state, match, start, end) => {
    const latex = match[1]
    const math = editorSchema.nodes.math_inline
    if (!math || !latex || /^\s|\s$/.test(latex)) return null
    const tr = state.tr.replaceWith(start, end, math.create({ latex }))
    const $afterMath = tr.doc.resolve(start + math.create().nodeSize)
    return tr.setSelection(TextSelection.near($afterMath, 1))
  })
}

function completedMathBlockRule(): InputRule {
  return new InputRule(/^\$\$(.+)\$\$$/, (state, match, start, end) => {
    const latex = match[1].trim()
    const math = schema.nodes.math_block
    const paragraph = schema.nodes.paragraph
    if (!math || !paragraph || !latex || latex.includes('\ufffc')) return null
    const $start = state.doc.resolve(start)
    if ($start.parent.type !== paragraph || $start.parent.content.size !== end - start) return null

    const sourceId = typeof $start.parent.attrs.id === 'string' ? $start.parent.attrs.id : null
    const blockPos = $start.before()
    const tr = state.tr.replaceWith(blockPos, $start.after(), [
      math.create({ latex, id: sourceId }),
      paragraph.create(),
    ])
    return tr.setSelection(TextSelection.create(tr.doc, blockPos + math.create().nodeSize + 1))
  })
}

function mathBlockRule(): InputRule {
  return new InputRule(/^\$\$\s$/, (state, _match, start, end) => {
    const math = schema.nodes.math_block
    const paragraph = schema.nodes.paragraph
    if (!math || !paragraph) return null
    const $start = state.doc.resolve(start)
    if ($start.parent.type !== paragraph || $start.parent.content.size !== end - start) return null

    const sourceId = typeof $start.parent.attrs.id === 'string' ? $start.parent.attrs.id : null
    const blockPos = $start.before()
    const tr = state.tr.replaceWith(blockPos, $start.after(), [
      math.create({ latex: '', id: sourceId }),
      paragraph.create(),
    ])
    return tr.setSelection(NodeSelection.create(tr.doc, blockPos))
  })
}

export function buildMarkdownTypingRules(): InputRule[] {
  const rules: InputRule[] = [dividerRule(), mathBlockRule(), completedMathBlockRule(), inlineMathRule(schema)]
  const code = schema.marks.code
  const strong = schema.marks.strong
  const em = schema.marks.em

  // Delimiters are deliberately constrained to a single textblock segment.
  if (code) rules.push(inlineMarkRule(/`([^`\n]+)`$/, code, 1))
  if (strong) {
    rules.push(inlineMarkRule(/\*\*([^*\n]+)\*\*$/, strong, 2))
    rules.push(inlineMarkRule(/__([^_\n]+)__$/, strong, 2))
  }
  if (em) {
    rules.push(inlineMarkRule(/(?:^|\s)\*([^*\n]+)\*$/, em, 1))
    rules.push(inlineMarkRule(/(?:^|\s)_([^_\n]+)_$/, em, 1))
  }
  return rules
}

/** Inline-only math typing for compact editors such as floating notes. */
export function buildInlineMathTypingRules(editorSchema: Schema): InputRule[] {
  return [inlineMathRule(editorSchema)]
}

export const undoMarkdownTypingRule: Command = (state, dispatch) => undoInputRule(state, dispatch)
