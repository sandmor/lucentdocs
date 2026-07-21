import { Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

export type QuoteStyle = 'preserve' | 'straight' | 'smart'

export interface QuoteTypingPreferences {
  singleQuoteStyle: QuoteStyle
  doubleQuoteStyle: QuoteStyle
}

export const DEFAULT_QUOTE_TYPING_PREFERENCES: QuoteTypingPreferences = {
  singleQuoteStyle: 'smart',
  doubleQuoteStyle: 'smart',
}

const SINGLE_QUOTES = new Set(["'", '‘', '’'])
const DOUBLE_QUOTES = new Set(['"', '“', '”'])
const OPENING_CONTEXT = /[\s[({<—–-]/

function isPendingInlineCode(view: EditorView, from: number): boolean {
  const $from = view.state.doc.resolve(from)
  if ($from.parent.type.spec.code) return true
  const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n')
  return (before.match(/`/g)?.length ?? 0) % 2 === 1
}

function smartQuote(view: EditorView, from: number, quote: 'single' | 'double'): string {
  const $from = view.state.doc.resolve(from)
  const before = $from.parent.textBetween(0, $from.parentOffset, '', '')
  const previous = before.at(-1) ?? ''
  if (quote === 'single' && /[\p{L}\p{N}]/u.test(previous)) return '’'
  const opening = previous.length === 0 || OPENING_CONTEXT.test(previous)
  if (quote === 'single') return opening ? '‘' : '’'
  return opening ? '“' : '”'
}

/** Only ProseMirror text input reaches this hook; paste and remote transactions do not. */
export function createQuoteTypingPlugin(getPreferences: () => QuoteTypingPreferences): Plugin {
  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        if (text.length !== 1 || isPendingInlineCode(view, from)) return false
        const quote = SINGLE_QUOTES.has(text) ? 'single' : DOUBLE_QUOTES.has(text) ? 'double' : null
        if (!quote) return false
        const style =
          quote === 'single' ? getPreferences().singleQuoteStyle : getPreferences().doubleQuoteStyle
        if (style === 'preserve') return false
        const replacement =
          style === 'straight' ? (quote === 'single' ? "'" : '"') : smartQuote(view, from, quote)
        view.dispatch(view.state.tr.insertText(replacement, from, to))
        return true
      },
    },
  })
}
