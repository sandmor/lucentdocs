import { Plugin, PluginKey } from 'prosemirror-state'
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
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}]/u
const LEADING_ELISIONS = new Set([
  'bout',
  'cause',
  'cept',
  'course',
  'em',
  'fore',
  'fraid',
  'gainst',
  'mid',
  'mong',
  'n',
  'neath',
  'nuff',
  'pon',
  'round',
  'scuse',
  'sup',
  'til',
  'tis',
  'twas',
  'tween',
  'twere',
  'twill',
  'twould',
])

interface PendingLeadingApostrophe {
  pos: number
}

interface QuoteTypingState {
  pending: PendingLeadingApostrophe | null
}

interface QuoteTypingMeta {
  pending?: PendingLeadingApostrophe
  clearPending?: boolean
}

const quoteTypingKey = new PluginKey<QuoteTypingState>('quoteTyping')

function isWordCharacter(value: string): boolean {
  return WORD_CHARACTER.test(value)
}

function isRecognizedLeadingElision(value: string): boolean {
  const normalized = value.toLocaleLowerCase()
  return LEADING_ELISIONS.has(normalized) || /^\d{2}s?$/u.test(normalized)
}

function leadingTokenAfter(text: string): { token: string; hasBoundary: boolean } {
  const match = text.match(/^([\p{L}\p{M}\p{N}]+)/u)
  if (!match) return { token: '', hasBoundary: text.length > 0 }
  return { token: match[1], hasBoundary: match[1].length < text.length }
}

function isPendingInlineCode(view: EditorView, from: number): boolean {
  const $from = view.state.doc.resolve(from)
  if ($from.parent.type.spec.code) return true
  if ($from.marks().some((mark) => mark.type.spec.code)) return true
  const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n')
  return (before.match(/`/g)?.length ?? 0) % 2 === 1
}

function smartQuote(view: EditorView, from: number, quote: 'single' | 'double'): string {
  const $from = view.state.doc.resolve(from)
  const before = $from.parent.textBetween(0, $from.parentOffset, '', '')
  const previous = before.at(-1) ?? ''
  if (quote === 'single' && isWordCharacter(previous)) return '’'

  if (quote === 'single' && (previous.length === 0 || OPENING_CONTEXT.test(previous))) {
    const after = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, '', '')
    const { token, hasBoundary } = leadingTokenAfter(after)
    if (token && isRecognizedLeadingElision(token) && (hasBoundary || after.length === token.length)) {
      return '’'
    }
  }

  const opening = previous.length === 0 || OPENING_CONTEXT.test(previous)
  if (quote === 'single') return opening ? '‘' : '’'
  return opening ? '“' : '”'
}

function pendingLeadingApostrophe(state: import('prosemirror-state').EditorState): PendingLeadingApostrophe | null {
  return quoteTypingKey.getState(state)?.pending ?? null
}

function resolvePendingLeadingApostrophe(
  state: import('prosemirror-state').EditorState,
  pending: PendingLeadingApostrophe
) {
  const $quote = state.doc.resolve(pending.pos)
  const quote = $quote.parent.textBetween($quote.parentOffset, $quote.parentOffset + 1, '', '')
  if (quote !== '‘') return { shouldResolve: true, apostrophe: false }

  const after = $quote.parent.textBetween($quote.parentOffset + 1, $quote.parent.content.size, '', '')
  const { token, hasBoundary } = leadingTokenAfter(after)
  const cursorAtTokenEnd =
    state.selection.from === pending.pos + 1 + token.length && state.selection.empty
  const shouldResolve = hasBoundary || !cursorAtTokenEnd

  return {
    shouldResolve,
    apostrophe: token.length > 0 && isRecognizedLeadingElision(token),
  }
}

/** Only ProseMirror text input reaches this hook; paste and remote transactions do not. */
export function createQuoteTypingPlugin(getPreferences: () => QuoteTypingPreferences): Plugin {
  return new Plugin({
    key: quoteTypingKey,
    state: {
      init: () => ({ pending: null }),
      apply(tr, previous): QuoteTypingState {
        const meta = tr.getMeta(quoteTypingKey) as QuoteTypingMeta | undefined
        let pending = previous.pending

        if (pending) {
          const pos = tr.mapping.map(pending.pos, 1)
          const $pos = tr.doc.resolve(pos)
          const quote = $pos.parent.textBetween($pos.parentOffset, $pos.parentOffset + 1, '', '')
          pending = quote === '‘' ? { pos } : null
        }

        if (meta?.pending) pending = meta.pending
        if (meta?.clearPending) pending = null
        return { pending }
      },
    },
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
        const tr = view.state.tr.insertText(replacement, from, to)
        if (
          style === 'smart' &&
          quote === 'single' &&
          replacement === '‘' &&
          from === to
        ) {
          tr.setMeta(quoteTypingKey, { pending: { pos: from } } satisfies QuoteTypingMeta)
        }
        view.dispatch(tr)
        return true
      },
    },
    appendTransaction(_transactions, _oldState, newState) {
      const pending = pendingLeadingApostrophe(newState)
      if (!pending) return null

      const result = resolvePendingLeadingApostrophe(newState, pending)
      if (!result.shouldResolve) return null

      const tr = newState.tr.setMeta(quoteTypingKey, { clearPending: true } satisfies QuoteTypingMeta)
      if (result.apostrophe) {
        tr.insertText('’', pending.pos, pending.pos + 1).setMeta('addToHistory', false)
      }
      return tr
    },
  })
}
