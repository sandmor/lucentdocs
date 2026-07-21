import { InputRule, undoInputRule } from 'prosemirror-inputrules'
import { type Command } from 'prosemirror-state'
import { TextSelection } from 'prosemirror-state'
import type { MarkType } from 'prosemirror-model'
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

function inlineMarkRule(pattern: RegExp, markType: MarkType): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const text = match[1]
    if (!text || /^\s|\s$/.test(text)) return null
    const from = start + match[0].indexOf(text)
    const tr = state.tr.delete(start, from).delete(from + text.length, end)
    const mappedFrom = tr.mapping.map(from, -1)
    const mappedTo = mappedFrom + text.length
    tr.addMark(mappedFrom, mappedTo, markType.create())
    return tr.setSelection(TextSelection.create(tr.doc, mappedTo))
  })
}

export function buildMarkdownTypingRules(): InputRule[] {
  const rules: InputRule[] = [dividerRule()]
  const code = schema.marks.code
  const strong = schema.marks.strong
  const em = schema.marks.em

  // Delimiters are deliberately constrained to a single textblock segment.
  if (code) rules.push(inlineMarkRule(/`([^`\n]+)`$/, code))
  if (strong) {
    rules.push(inlineMarkRule(/\*\*([^*\n]+)\*\*$/, strong))
    rules.push(inlineMarkRule(/__([^_\n]+)__$/, strong))
  }
  if (em) {
    rules.push(inlineMarkRule(/(?:^|\s)\*([^*\n]+)\*$/, em))
    rules.push(inlineMarkRule(/(?:^|\s)_([^_\n]+)_$/, em))
  }
  return rules
}

export const undoMarkdownTypingRule: Command = (state, dispatch) => undoInputRule(state, dispatch)
