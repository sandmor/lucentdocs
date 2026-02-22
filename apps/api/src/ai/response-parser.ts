import { createRequire } from 'node:module'
import {
  Edit,
  Language,
  Parser as TreeSitterParser,
  type Node as TreeSitterNode,
  type Point,
  type Tree,
} from 'web-tree-sitter'

export type AIMode = 'replace' | 'insert' | 'choices'

export interface ReplaceResponse {
  mode: 'replace'
  content: string
}

export interface InsertResponse {
  mode: 'insert'
  index: number
  content: string
}

export interface ChoicesResponse {
  mode: 'choices'
  choices: string[]
}

export type AIResponse = ReplaceResponse | InsertResponse | ChoicesResponse

export interface StreamingParserResult {
  mode: AIMode | null
  insertIndex: number | null
  content: string
  choices: string[]
  isComplete: boolean
}

interface StringStart {
  quote: "'" | '"'
  triple: boolean
  raw: boolean
  contentStart: number
}

interface ModeCandidate {
  mode: AIMode
  startIndex: number
  methodOpenParenIndex: number
  insertIndex: number | null
}

interface ContentParseResult {
  content: string
  complete: boolean
}

interface ChoicesParseResult {
  choices: string[]
  complete: boolean
}

const require = createRequire(import.meta.url)
const PYTHON_LANGUAGE_WASM_PATH = require.resolve('tree-sitter-python/tree-sitter-python.wasm')

async function loadPythonLanguage() {
  await TreeSitterParser.init()
  return await Language.load(PYTHON_LANGUAGE_WASM_PATH)
}

const PYTHON_LANGUAGE = await loadPythonLanguage()

function isPrefixLetter(char: string): boolean {
  return /^[rRuUbBfF]$/.test(char)
}

function isEscaped(text: string, position: number): boolean {
  let slashes = 0
  for (let i = position - 1; i >= 0; i -= 1) {
    if (text[i] !== '\\') break
    slashes += 1
  }
  return slashes % 2 === 1
}

function skipWhitespace(text: string, start: number): number {
  let i = start
  while (i < text.length && /\s/.test(text[i])) i += 1
  return i
}

function detectStringStartAt(text: string, start: number): StringStart | null {
  const i = skipWhitespace(text, start)

  let j = i
  while (j < text.length && isPrefixLetter(text[j])) j += 1
  if (j >= text.length) return null

  const quote = text[j]
  if (quote !== "'" && quote !== '"') return null

  const triple = text[j + 1] === quote && text[j + 2] === quote
  const raw = text.slice(i, j).toLowerCase().includes('r')
  const contentStart = j + (triple ? 3 : 1)

  return {
    quote,
    triple,
    raw,
    contentStart,
  }
}

function findStringEnd(text: string, start: number, delimiter: string, raw: boolean): number {
  if (delimiter.length === 1) {
    for (let i = start; i < text.length; i += 1) {
      if (text[i] !== delimiter) continue
      if (!raw && isEscaped(text, i)) continue
      return i
    }
    return -1
  }

  for (let i = start; i <= text.length - delimiter.length; i += 1) {
    if (text.slice(i, i + delimiter.length) !== delimiter) continue
    if (!raw && isEscaped(text, i)) continue
    return i
  }
  return -1
}

function computeIncompleteContentTail(
  source: string,
  contentStart: number,
  quote: "'" | '"',
  triple: boolean,
  raw: boolean
): number {
  if (!triple) return 0

  let safeTail = 0
  const minIndex = Math.max(contentStart, source.length - 2)

  for (let i = source.length - 1; i >= minIndex; i -= 1) {
    if (source[i] !== quote) continue
    if (!raw && isEscaped(source, i)) continue

    const tailLength = source.length - i
    if (tailLength <= 2) {
      safeTail = Math.max(safeTail, tailLength)
    }
  }

  return safeTail
}

function parseContentArgumentFrom(
  source: string,
  methodOpenParenIndex: number
): ContentParseResult | null {
  let i = skipWhitespace(source, methodOpenParenIndex)
  if (source[i] !== '(') return null

  i += 1
  const start = detectStringStartAt(source, i)
  if (!start) return null

  const delimiter = start.triple ? start.quote.repeat(3) : start.quote
  const endIndex = findStringEnd(source, start.contentStart, delimiter, start.raw)
  if (endIndex !== -1) {
    return {
      content: source.slice(start.contentStart, endIndex),
      complete: true,
    }
  }

  const partial = source.slice(start.contentStart)
  const safeTail = computeIncompleteContentTail(
    source,
    start.contentStart,
    start.quote,
    start.triple,
    start.raw
  )
  return {
    content: safeTail > 0 ? partial.slice(0, -safeTail) : partial,
    complete: false,
  }
}

function parseChoicesArgumentFrom(
  source: string,
  methodOpenParenIndex: number
): ChoicesParseResult | null {
  let i = skipWhitespace(source, methodOpenParenIndex)
  if (source[i] !== '(') return null

  i += 1
  i = skipWhitespace(source, i)
  if (source[i] !== '(') return null

  i += 1
  let tupleOpenParens = 1

  let inString = false
  let stringQuote: "'" | '"' | null = null
  let stringTriple = false
  let stringRaw = false
  let currentChoice = ''

  const choices: string[] = []

  while (i < source.length && tupleOpenParens > 0) {
    const char = source[i]

    if (inString) {
      const quote = stringQuote!
      const delimiter = stringTriple ? quote.repeat(3) : quote

      if (stringTriple) {
        if (i + 2 >= source.length) {
          break
        }
        if (source.slice(i, i + 3) === delimiter && (stringRaw || !isEscaped(source, i))) {
          inString = false
          stringQuote = null
          stringTriple = false
          stringRaw = false
          choices.push(currentChoice)
          currentChoice = ''
          i += 3
          continue
        }
      } else if (char === quote && (stringRaw || !isEscaped(source, i))) {
        inString = false
        stringQuote = null
        choices.push(currentChoice)
        currentChoice = ''
        i += 1
        continue
      }

      currentChoice += char
      i += 1
      continue
    }

    const start = detectStringStartAt(source, i)
    if (start) {
      inString = true
      stringQuote = start.quote
      stringTriple = start.triple
      stringRaw = start.raw
      i = start.contentStart
      continue
    }

    if (char === '(') tupleOpenParens += 1
    else if (char === ')') tupleOpenParens -= 1
    i += 1
  }

  return {
    choices,
    complete: tupleOpenParens === 0 && !inString,
  }
}

function advancePoint(point: Point, appendedText: string): Point {
  const lines = appendedText.split('\n')
  if (lines.length === 1) {
    return {
      row: point.row,
      column: point.column + Buffer.byteLength(appendedText, 'utf8'),
    }
  }
  return {
    row: point.row + lines.length - 1,
    column: Buffer.byteLength(lines[lines.length - 1], 'utf8'),
  }
}

function parseInsertIndexFromCall(callNode: TreeSitterNode): number | null {
  const argumentList = callNode.childForFieldName('arguments')
  if (!argumentList) return null
  const match = argumentList.text.match(/^\(\s*(-?\d+)\s*\)$/)
  if (!match) return null

  const value = Number.parseInt(match[1], 10)
  return Number.isFinite(value) ? value : null
}

function modeCandidateFromAttribute(attributeNode: TreeSitterNode): ModeCandidate | null {
  const methodIdentifier = attributeNode.childForFieldName('attribute')
  const objectNode = attributeNode.childForFieldName('object')

  if (!methodIdentifier || methodIdentifier.type !== 'identifier') return null
  if (!objectNode || objectNode.type !== 'call') return null

  const constructorIdentifier = objectNode.childForFieldName('function')
  if (!constructorIdentifier || constructorIdentifier.type !== 'identifier') return null

  const methodName = methodIdentifier.text
  const constructorName = constructorIdentifier.text

  if (methodName === 'with_content' && constructorName === 'ReplaceText') {
    return {
      mode: 'replace',
      startIndex: objectNode.startIndex,
      methodOpenParenIndex: attributeNode.endIndex,
      insertIndex: null,
    }
  }

  if (methodName === 'with_content' && constructorName === 'InsertText') {
    return {
      mode: 'insert',
      startIndex: objectNode.startIndex,
      methodOpenParenIndex: attributeNode.endIndex,
      insertIndex: parseInsertIndexFromCall(objectNode),
    }
  }

  if (methodName === 'with_choices' && constructorName === 'PresentChoices') {
    return {
      mode: 'choices',
      startIndex: objectNode.startIndex,
      methodOpenParenIndex: attributeNode.endIndex,
      insertIndex: null,
    }
  }

  return null
}

function extractModeCandidateFromTree(root: TreeSitterNode): ModeCandidate | null {
  const stack: TreeSitterNode[] = [root]
  let best: ModeCandidate | null = null

  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.type === 'attribute') {
      const candidate = modeCandidateFromAttribute(node)
      if (candidate && (!best || candidate.startIndex < best.startIndex)) {
        best = candidate
      }
    }

    const children = node.namedChildren
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i])
    }
  }

  return best
}

function extractModeCandidateFromText(source: string): ModeCandidate | null {
  const replaceMatch = source.match(/ReplaceText\s*\(\s*\)\s*\.with_content\s*\(/)
  const insertMatch = source.match(/InsertText\s*\(\s*(-?\d+)\s*\)\s*\.with_content\s*\(/)
  const choicesMatch = source.match(/PresentChoices\s*\(\s*\)\s*\.with_choices\s*\(/)

  const candidates: ModeCandidate[] = []

  if (replaceMatch && replaceMatch.index !== undefined) {
    candidates.push({
      mode: 'replace',
      startIndex: replaceMatch.index,
      methodOpenParenIndex: replaceMatch.index + replaceMatch[0].length - 1,
      insertIndex: null,
    })
  }

  if (insertMatch && insertMatch.index !== undefined) {
    candidates.push({
      mode: 'insert',
      startIndex: insertMatch.index,
      methodOpenParenIndex: insertMatch.index + insertMatch[0].length - 1,
      insertIndex: Number.parseInt(insertMatch[1], 10),
    })
  }

  if (choicesMatch && choicesMatch.index !== undefined) {
    candidates.push({
      mode: 'choices',
      startIndex: choicesMatch.index,
      methodOpenParenIndex: choicesMatch.index + choicesMatch[0].length - 1,
      insertIndex: null,
    })
  }

  if (candidates.length === 0) return null
  candidates.sort((left, right) => left.startIndex - right.startIndex)
  return candidates[0]
}

function pickBestCandidate(
  current: ModeCandidate | null,
  next: ModeCandidate | null
): ModeCandidate | null {
  if (!next) return current
  if (!current) return next
  if (next.startIndex < current.startIndex) return next
  if (next.startIndex > current.startIndex) return current

  return {
    ...current,
    methodOpenParenIndex: next.methodOpenParenIndex,
    insertIndex: next.insertIndex ?? current.insertIndex,
  }
}

export class ResponseParser {
  private parser: TreeSitterParser
  private tree: Tree | null = null
  private source = ''
  private sourceBytes = 0
  private sourceEndPosition: Point = { row: 0, column: 0 }

  private mode: AIMode | null = null
  private insertIndex: number | null = null
  private content = ''
  private choices: string[] = []
  private complete = false

  private modeCandidate: ModeCandidate | null = null

  constructor() {
    this.parser = new TreeSitterParser()
    this.parser.setLanguage(PYTHON_LANGUAGE)
  }

  private parseIncremental(chunk: string): void {
    const previousEnd = this.sourceEndPosition
    const previousBytes = this.sourceBytes
    const chunkBytes = Buffer.byteLength(chunk, 'utf8')

    this.source += chunk
    this.sourceBytes += chunkBytes
    this.sourceEndPosition = advancePoint(previousEnd, chunk)

    if (this.tree) {
      this.tree.edit(
        new Edit({
          startIndex: previousBytes,
          oldEndIndex: previousBytes,
          newEndIndex: this.sourceBytes,
          startPosition: previousEnd,
          oldEndPosition: previousEnd,
          newEndPosition: this.sourceEndPosition,
        })
      )
    }

    const parsed = this.parser.parse(this.source, this.tree)
    if (parsed) this.tree = parsed
  }

  private updateModeCandidate(): void {
    const treeCandidate = this.tree ? extractModeCandidateFromTree(this.tree.rootNode) : null
    const textCandidate = extractModeCandidateFromText(this.source)

    let candidate = pickBestCandidate(treeCandidate, textCandidate)
    candidate = pickBestCandidate(this.modeCandidate, candidate)
    if (!candidate) return

    this.modeCandidate = candidate
    this.mode = candidate.mode
    if (candidate.mode === 'insert' && candidate.insertIndex !== null) {
      this.insertIndex = candidate.insertIndex
    }
  }

  private updateValueState(): void {
    if (!this.modeCandidate) return

    if (this.modeCandidate.mode === 'replace' || this.modeCandidate.mode === 'insert') {
      const result = parseContentArgumentFrom(this.source, this.modeCandidate.methodOpenParenIndex)
      if (!result) return
      this.content = result.content
      this.complete = result.complete
      if (this.modeCandidate.mode === 'insert' && this.insertIndex === null) {
        this.insertIndex = this.modeCandidate.insertIndex ?? 0
      }
      return
    }

    const choicesResult = parseChoicesArgumentFrom(
      this.source,
      this.modeCandidate.methodOpenParenIndex
    )
    if (!choicesResult) return
    this.choices = choicesResult.choices
    this.complete = choicesResult.complete
  }

  feed(chunk: string): StreamingParserResult {
    if (chunk.length > 0) {
      this.parseIncremental(chunk)
      this.updateModeCandidate()
      this.updateValueState()
    }

    return {
      mode: this.mode,
      insertIndex: this.insertIndex,
      content: this.content,
      choices: this.choices,
      isComplete: this.complete,
    }
  }

  finalize(): AIResponse | null {
    if (!this.mode) return null
    if (this.mode === 'replace') return { mode: 'replace', content: this.content }
    if (this.mode === 'insert')
      return { mode: 'insert', index: this.insertIndex ?? 0, content: this.content }
    return { mode: 'choices', choices: this.choices }
  }
}

export function parseResponse(text: string): AIResponse | null {
  const parser = new ResponseParser()
  parser.feed(text)
  return parser.finalize()
}
