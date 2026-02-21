import { describe, test, expect } from 'bun:test'
import { ResponseParser, parseResponse } from './response-parser'

describe('ResponseParser', () => {
  describe('ReplaceText', () => {
    test('parses simple ReplaceText response', () => {
      const input = `def respond() -> ReplaceText | InsertText | PresentChoices:
    return ReplaceText().with_content("""exclaimed""")`

      const result = parseResponse(input)
      expect(result).toEqual({
        mode: 'replace',
        content: 'exclaimed',
      })
    })

    test('parses ReplaceText with multi-line content', () => {
      const input = `def respond() -> ReplaceText | InsertText | PresentChoices:
    return ReplaceText().with_content("""Hello
world!
This is a test.""")`

      const result = parseResponse(input)
      expect(result).toEqual({
        mode: 'replace',
        content: 'Hello\nworld!\nThis is a test.',
      })
    })

    test('parses ReplaceText with single-quoted triple string', () => {
      const input = `def respond() -> ReplaceText | InsertText | PresentChoices:
    return ReplaceText().with_content('''quietly''')`

      const result = parseResponse(input)
      expect(result).toEqual({
        mode: 'replace',
        content: 'quietly',
      })
    })
  })

  describe('InsertText', () => {
    test('parses InsertText with index 0', () => {
      const input = `def respond() -> ReplaceText | InsertText | PresentChoices:
    return InsertText(0).with_content("""very """)`

      const result = parseResponse(input)
      expect(result).toEqual({
        mode: 'insert',
        index: 0,
        content: 'very ',
      })
    })

    test('parses InsertText with negative index', () => {
      const input = `def respond() -> ReplaceText | InsertText | PresentChoices:
    return InsertText(-1).with_content(""" loudly""")`

      const result = parseResponse(input)
      expect(result).toEqual({
        mode: 'insert',
        index: -1,
        content: ' loudly',
      })
    })
  })

  describe('PresentChoices', () => {
    test('parses PresentChoices with multiple options', () => {
      const input = `def respond() -> ReplaceText | InsertText | PresentChoices:
    return PresentChoices().with_choices(("whispered", "muttered", "exclaimed"))`

      const result = parseResponse(input)
      expect(result).toEqual({
        mode: 'choices',
        choices: ['whispered', 'muttered', 'exclaimed'],
      })
    })

    test('parses PresentChoices with single option', () => {
      const input = `def respond() -> ReplaceText | InsertText | PresentChoices:
    return PresentChoices().with_choices(("only one",))`

      const result = parseResponse(input)
      expect(result).toEqual({
        mode: 'choices',
        choices: ['only one'],
      })
    })
  })

  describe('Streaming', () => {
    test('streams content incrementally', () => {
      const parser = new ResponseParser()

      const chunk1 = `def respond() -> ReplaceText | InsertText | PresentChoices:
    return ReplaceText().with_content("""Hello `
      const result1 = parser.feed(chunk1)

      expect(result1.mode).toBe('replace')
      expect(result1.isComplete).toBe(false)

      const chunk2 = `World""")`
      const result2 = parser.feed(chunk2)

      expect(result2.content).toBe('Hello World')
      expect(result2.isComplete).toBe(true)

      const final = parser.finalize()
      expect(final).toEqual({
        mode: 'replace',
        content: 'Hello World',
      })
    })

    test('streams choices incrementally', () => {
      const parser = new ResponseParser()

      const chunk1 = `def respond() -> ReplaceText | InsertText | PresentChoices:
    return PresentChoices().with_choices(("one"`
      const result1 = parser.feed(chunk1)

      expect(result1.mode).toBe('choices')
      expect(result1.choices).toEqual(['one'])
      expect(result1.isComplete).toBe(false)

      const chunk2 = `, "two"`
      const result2 = parser.feed(chunk2)

      expect(result2.choices).toEqual(['one', 'two'])
      expect(result2.isComplete).toBe(false)

      const chunk3 = `))`
      const result3 = parser.feed(chunk3)

      expect(result3.isComplete).toBe(true)
    })

    test('stops content at triple-quote even when closing parenthesis is split across later chunks', () => {
      const parser = new ResponseParser()

      const chunk1 = `def respond():
    return ReplaceText().with_content(
        """Cat and dog and rabbit and squirrel and owl and fox and deer and mouse and turtle and frog and duck and fish.`
      const chunk2 = `"""`
      const chunk3 = `\n  `
      const chunk4 = `  )`

      const result1 = parser.feed(chunk1)
      expect(result1.mode).toBe('replace')
      expect(result1.isComplete).toBe(false)

      const result2 = parser.feed(chunk2)
      expect(result2.isComplete).toBe(true)
      expect(result2.content).toBe(
        'Cat and dog and rabbit and squirrel and owl and fox and deer and mouse and turtle and frog and duck and fish.'
      )

      const result3 = parser.feed(chunk3)
      const result4 = parser.feed(chunk4)

      expect(result3.content).toBe(result2.content)
      expect(result4.content).toBe(result2.content)
      expect(parser.finalize()).toEqual({
        mode: 'replace',
        content:
          'Cat and dog and rabbit and squirrel and owl and fox and deer and mouse and turtle and frog and duck and fish.',
      })
    })

    test('handles split triple-quote delimiter across chunk boundaries', () => {
      const parser = new ResponseParser()

      const chunk1 = `def respond():\n    return ReplaceText().with_content("""alpha`
      const chunk2 = `""`
      const chunk3 = `"\n  )`

      const result1 = parser.feed(chunk1)
      expect(result1.mode).toBe('replace')
      expect(result1.isComplete).toBe(false)

      const result2 = parser.feed(chunk2)
      expect(result2.isComplete).toBe(false)

      const result3 = parser.feed(chunk3)
      expect(result3.isComplete).toBe(true)
      expect(result3.content).toBe('alpha')
      expect(parser.finalize()).toEqual({
        mode: 'replace',
        content: 'alpha',
      })
    })

    test('detects earliest class call when multiple modes appear in output', () => {
      const parser = new ResponseParser()
      const input = `def respond():
    return PresentChoices().with_choices(("one", "two"))
    # accidental extra text
    ReplaceText().with_content("""ignored""")`

      const result = parser.feed(input)
      expect(result.mode).toBe('choices')
      expect(result.choices).toEqual(['one', 'two'])
      expect(result.isComplete).toBe(true)
      expect(parser.finalize()).toEqual({
        mode: 'choices',
        choices: ['one', 'two'],
      })
    })
  })
})
