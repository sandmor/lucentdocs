import { describe, expect, test } from 'bun:test'
import { schema } from '@lucentdocs/shared'
import { EditorState, TextSelection } from 'prosemirror-state'
import type { Transaction } from 'prosemirror-state'
import {
  createQuoteTypingPlugin,
  type QuoteTypingPreferences,
} from './quote-typing-plugin.js'

interface TestView {
  state: EditorState
  dispatch: (tr: Transaction) => void
}

function createView(preferences: QuoteTypingPreferences): {
  plugin: ReturnType<typeof createQuoteTypingPlugin>
  view: TestView
} {
  const doc = schema.node('doc', null, [schema.node('paragraph')])
  const plugin = createQuoteTypingPlugin(() => preferences)
  const view: TestView = {
    state: EditorState.create({ doc, selection: TextSelection.create(doc, 1), plugins: [plugin] }),
    dispatch(tr) {
      this.state = this.state.apply(tr)
    },
  }
  return { plugin, view }
}

function typeText(view: TestView, plugin: ReturnType<typeof createQuoteTypingPlugin>, text: string) {
  for (const character of text) {
    const { from, to } = view.state.selection
    const handled = plugin.props.handleTextInput?.call(plugin, view as never, from, to, character, () =>
      view.state.tr.insertText(character, from, to)
    )
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to))
  }
}

const smart: QuoteTypingPreferences = { singleQuoteStyle: 'smart', doubleQuoteStyle: 'smart' }

describe('smart quote typing', () => {
  test.each([
    ["don't", 'don’t'],
    ["l'amour", 'l’amour'],
    ["O'Connor", 'O’Connor'],
    ["dogs'", 'dogs’'],
  ])('uses apostrophes inside or after words: %s', (source, expected) => {
    const { plugin, view } = createView(smart)
    typeText(view, plugin, source)
    expect(view.state.doc.textContent).toBe(expected)
  })

  test.each([
    ["'tis ", '’tis '],
    ["'Twas ", '’Twas '],
    ["'neath ", '’neath '],
    ["rock 'n' roll", 'rock ’n’ roll'],
    ["'90s ", '’90s '],
  ])('recognizes leading elisions and abbreviated years: %s', (source, expected) => {
    const { plugin, view } = createView(smart)
    typeText(view, plugin, source)
    expect(view.state.doc.textContent).toBe(expected)
  })

  test('keeps ordinary leading words as opening quotes', () => {
    const { plugin, view } = createView(smart)
    typeText(view, plugin, "'tissue ")
    expect(view.state.doc.textContent).toBe('‘tissue ')
  })

  test('uses opening and closing quotes around ordinary words', () => {
    const { plugin, view } = createView(smart)
    typeText(view, plugin, "'hello' ")
    expect(view.state.doc.textContent).toBe('‘hello’ ')
  })

  test('does not rewrite quotes in an inline code mark', () => {
    const code = schema.marks.code.create()
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('code', [code])])])
    const plugin = createQuoteTypingPlugin(() => smart)
    const view: TestView = {
      state: EditorState.create({ doc, selection: TextSelection.create(doc, 3), plugins: [plugin] }),
      dispatch(tr) {
        this.state = this.state.apply(tr)
      },
    }

    typeText(view, plugin, "'")
    expect(view.state.doc.textContent).toBe("co'de")
  })

  test('honors straight and preserve preferences', () => {
    const straight = createView({ singleQuoteStyle: 'straight', doubleQuoteStyle: 'straight' })
    typeText(straight.view, straight.plugin, "'hello'")
    expect(straight.view.state.doc.textContent).toBe("'hello'")

    const preserve = createView({ singleQuoteStyle: 'preserve', doubleQuoteStyle: 'preserve' })
    typeText(preserve.view, preserve.plugin, '‘hello’')
    expect(preserve.view.state.doc.textContent).toBe('‘hello’')
  })
})
