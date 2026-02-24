import { describe, test, expect } from 'bun:test'
import { ResponseParser, parseResponse } from './response-parser'

describe('ResponseParser', () => {
  test('parses complete replace response', () => {
    const result = parseResponse({
      mode: 'replace',
      insertIndex: null,
      content: 'exclaimed',
      choices: null,
    })

    expect(result).toEqual({
      mode: 'replace',
      content: 'exclaimed',
    })
  })

  test('parses complete insert response', () => {
    const result = parseResponse({
      mode: 'insert',
      insertIndex: -1,
      content: ' quietly',
      choices: null,
    })

    expect(result).toEqual({
      mode: 'insert',
      index: -1,
      content: ' quietly',
    })
  })

  test('parses complete choices response', () => {
    const result = parseResponse({
      mode: 'choices',
      insertIndex: null,
      content: null,
      choices: ['whispered', 'muttered', 'exclaimed'],
    })

    expect(result).toEqual({
      mode: 'choices',
      choices: ['whispered', 'muttered', 'exclaimed'],
    })
  })

  test('streams partial replace content incrementally', () => {
    const parser = new ResponseParser()

    const result1 = parser.feed({ mode: 'replace', content: 'Hello ' })
    expect(result1.mode).toBe('replace')
    expect(result1.isComplete).toBe(false)
    expect(result1.content).toBe('Hello ')

    const result2 = parser.feed({ content: 'Hello world' })
    expect(result2.mode).toBe('replace')
    expect(result2.content).toBe('Hello world')

    const result3 = parser.feedComplete({
      mode: 'replace',
      insertIndex: null,
      content: 'Hello world',
      choices: null,
    })
    expect(result3.isComplete).toBe(true)
    expect(parser.finalize()).toEqual({
      mode: 'replace',
      content: 'Hello world',
    })
  })

  test('streams partial insert response and defaults index to zero when missing', () => {
    const parser = new ResponseParser()

    parser.feed({ mode: 'insert', content: 'very ' })
    expect(parser.finalize()).toEqual({
      mode: 'insert',
      index: 0,
      content: 'very ',
    })

    parser.feed({ insertIndex: 4, content: 'very softly ' })
    expect(parser.finalize()).toEqual({
      mode: 'insert',
      index: 4,
      content: 'very softly ',
    })
  })

  test('parses complete insert response with legacy index field', () => {
    const result = parseResponse({
      mode: 'insert',
      index: 7,
      insertIndex: null,
      content: 'mid-sentence',
      choices: null,
    })

    expect(result).toEqual({
      mode: 'insert',
      index: 7,
      content: 'mid-sentence',
    })
  })

  test('parses insert response when unrelated fields are omitted', () => {
    const result = parseResponse({
      mode: 'insert',
      insertIndex: 2,
      content: 'hello',
    })

    expect(result).toEqual({
      mode: 'insert',
      index: 2,
      content: 'hello',
    })
  })

  test('parses choices response when unrelated fields are omitted', () => {
    const result = parseResponse({
      mode: 'choices',
      choices: ['x', 'y'],
    })

    expect(result).toEqual({
      mode: 'choices',
      choices: ['x', 'y'],
    })
  })

  test('streams partial insert response with legacy index field', () => {
    const parser = new ResponseParser()

    parser.feed({ mode: 'insert', index: 3, content: 'abc' })

    expect(parser.finalize()).toEqual({
      mode: 'insert',
      index: 3,
      content: 'abc',
    })
  })

  test('keeps insert index when partial index arrives before mode', () => {
    const parser = new ResponseParser()

    parser.feed({ insertIndex: 5, content: 'later-mode' })
    parser.feed({ mode: 'insert' })

    expect(parser.finalize()).toEqual({
      mode: 'insert',
      index: 5,
      content: 'later-mode',
    })
  })

  test('streams partial choices and finalizes on complete output', () => {
    const parser = new ResponseParser()

    parser.feed({ mode: 'choices' })
    parser.feed({ choices: ['one', 'two'] })
    const result = parser.feedComplete({
      mode: 'choices',
      insertIndex: null,
      content: null,
      choices: ['one', 'two', 'three'],
    })

    expect(result.mode).toBe('choices')
    expect(result.choices).toEqual(['one', 'two', 'three'])
    expect(result.isComplete).toBe(true)
    expect(parser.finalize()).toEqual({
      mode: 'choices',
      choices: ['one', 'two', 'three'],
    })
  })
})
