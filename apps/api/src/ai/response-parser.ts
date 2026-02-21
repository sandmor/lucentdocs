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

type ParserState =
  | 'searching_for_class'
  | 'found_replace'
  | 'found_insert_waiting_content'
  | 'found_choices_waiting_tuple'
  | 'parsing_content_quoted'
  | 'parsing_choices_tuple'
  | 'complete'

export class ResponseParser {
  private state: ParserState = 'searching_for_class'
  private buffer = ''
  private insertIndex: number | null = null
  private content = ''
  private choices: string[] = []
  private mode: AIMode | null = null
  private contentDelimiter: '"""' | "'''" | null = null

  getMode(): AIMode | null {
    return this.mode
  }

  getInsertIndex(): number | null {
    return this.insertIndex
  }

  feed(chunk: string): StreamingParserResult {
    this.buffer += chunk

    let iterations = 0
    const maxIterations = 1000

    while (this.buffer.length > 0 && iterations < maxIterations) {
      iterations++

      if (this.state === 'complete') {
        break
      }

      let consumed = false

      if (this.state === 'searching_for_class') {
        consumed = this.searchForClass()
      } else if (
        this.state === 'found_replace' ||
        this.state === 'found_insert_waiting_content' ||
        this.state === 'found_choices_waiting_tuple'
      ) {
        consumed = this.searchForContentOrTuple()
      } else if (this.state === 'parsing_content_quoted') {
        consumed = this.parseContentQuoted()
      } else if (this.state === 'parsing_choices_tuple') {
        consumed = this.parseChoicesTuple()
      }

      if (!consumed) {
        this.trimBuffer()
        break
      }
    }

    return {
      mode: this.mode,
      insertIndex: this.insertIndex,
      content: this.content,
      choices: this.choices,
      isComplete: this.state === 'complete',
    }
  }

  private trimBuffer(): void {
    if (this.state === 'searching_for_class' && this.buffer.length > 1000) {
      this.buffer = this.buffer.slice(-120)
      return
    }

    if (
      (this.state === 'found_replace' ||
        this.state === 'found_insert_waiting_content' ||
        this.state === 'found_choices_waiting_tuple') &&
      this.buffer.length > 400
    ) {
      this.buffer = this.buffer.slice(-160)
    }
  }

  private searchForClass(): boolean {
    const replaceMatch = this.buffer.match(/ReplaceText\s*\(\s*\)/)
    const insertMatch = this.buffer.match(/InsertText\s*\(\s*(-?\d+)\s*\)/)
    const choicesMatch = this.buffer.match(/PresentChoices\s*\(\s*\)/)

    const candidates: Array<{
      kind: AIMode
      index: number
      length: number
      insertIndex?: number
    }> = []

    if (replaceMatch && replaceMatch.index !== undefined) {
      candidates.push({
        kind: 'replace',
        index: replaceMatch.index,
        length: replaceMatch[0].length,
      })
    }

    if (insertMatch && insertMatch.index !== undefined) {
      candidates.push({
        kind: 'insert',
        index: insertMatch.index,
        length: insertMatch[0].length,
        insertIndex: parseInt(insertMatch[1], 10),
      })
    }

    if (choicesMatch && choicesMatch.index !== undefined) {
      candidates.push({
        kind: 'choices',
        index: choicesMatch.index,
        length: choicesMatch[0].length,
      })
    }

    if (candidates.length === 0) {
      return false
    }

    candidates.sort((a, b) => a.index - b.index)
    const first = candidates[0]

    this.buffer = this.buffer.slice(first.index + first.length)
    this.mode = first.kind

    if (first.kind === 'replace') {
      this.state = 'found_replace'
      return true
    }

    if (first.kind === 'insert') {
      this.insertIndex = first.insertIndex ?? 0
      this.state = 'found_insert_waiting_content'
      return true
    }

    this.state = 'found_choices_waiting_tuple'
    return true
  }

  private searchForContentOrTuple(): boolean {
    if (this.state === 'found_replace' || this.state === 'found_insert_waiting_content') {
      const contentMatch = this.buffer.match(/\.with_content\s*\(\s*("""|''')/)

      if (contentMatch && contentMatch.index !== undefined) {
        this.buffer = this.buffer.slice(contentMatch.index + contentMatch[0].length)
        this.contentDelimiter = contentMatch[1] as '"""' | "'''"
        this.state = 'parsing_content_quoted'
        return true
      }
    }

    if (this.state === 'found_choices_waiting_tuple') {
      const choicesMatch = this.buffer.match(/\.with_choices\s*\(\s*\(/)

      if (choicesMatch && choicesMatch.index !== undefined) {
        this.buffer = this.buffer.slice(choicesMatch.index + choicesMatch[0].length)
        this.state = 'parsing_choices_tuple'
        return true
      }
    }

    return false
  }

  private parseContentQuoted(): boolean {
    if (!this.contentDelimiter) {
      return false
    }

    const delimiter = this.contentDelimiter
    const endIndex = this.buffer.indexOf(delimiter)

    if (endIndex !== -1) {
      this.content += this.buffer.slice(0, endIndex)
      this.buffer = this.buffer.slice(endIndex + delimiter.length)
      this.state = 'complete'
      return true
    }

    const dangerZone = delimiter.length - 1
    if (this.buffer.length > dangerZone) {
      this.content += this.buffer.slice(0, -dangerZone)
      this.buffer = this.buffer.slice(-dangerZone)
      return true
    }

    return false
  }

  private parseChoicesTuple(): boolean {
    let openParens = 1
    let i = 0
    let inString = false
    let stringEscape = false
    let currentChoice = ''
    const newChoices: string[] = []

    while (i < this.buffer.length && openParens > 0) {
      const char = this.buffer[i]

      if (stringEscape) {
        if (inString) {
          currentChoice += char
        }
        stringEscape = false
        i++
        continue
      }

      if (char === '\\' && inString) {
        stringEscape = true
        i++
        continue
      }

      if (char === '"' && !inString) {
        inString = true
        i++
        continue
      }

      if (char === '"' && inString) {
        inString = false
        newChoices.push(currentChoice)
        currentChoice = ''
        i++
        continue
      }

      if (inString) {
        currentChoice += char
        i++
        continue
      }

      if (char === '(') {
        openParens++
      } else if (char === ')') {
        openParens--
      }

      i++
    }

    if (newChoices.length > 0) {
      this.choices = [...this.choices, ...newChoices]
    }

    if (openParens === 0) {
      this.buffer = this.buffer.slice(i)
      this.state = 'complete'
      return true
    }

    if (newChoices.length > 0) {
      this.buffer = this.buffer.slice(i)
      return true
    }

    return false
  }

  finalize(): AIResponse | null {
    if (!this.mode) {
      return null
    }

    if (this.mode === 'replace') {
      return { mode: 'replace', content: this.content }
    }

    if (this.mode === 'insert') {
      return { mode: 'insert', index: this.insertIndex ?? 0, content: this.content }
    }

    return { mode: 'choices', choices: this.choices }
  }
}

export function parseResponse(text: string): AIResponse | null {
  const parser = new ResponseParser()
  parser.feed(text)
  return parser.finalize()
}
