import MarkdownIt from 'markdown-it'
import { MarkdownParser } from 'prosemirror-markdown'
import { Fragment, Slice, type Node as ProseMirrorNode } from 'prosemirror-model'
import { schema } from './schema.js'
import { noteSchema } from './note-schema.js'

export interface MarkdownishSliceOptions {
  openStart?: boolean
  openEnd?: boolean
  target?: 'document' | 'note'
}

const markdownIt = new MarkdownIt('commonmark', {
  html: false,
  linkify: true,
  breaks: true,
})

/** Canonical Lucent math: $inline$ and a standalone $$ display block. */
markdownIt.block.ruler.before('fence', 'lucent-math-block', (state, startLine, endLine, silent) => {
  const start = state.bMarks[startLine] + state.tShift[startLine]
  const max = state.eMarks[startLine]
  if (state.sCount[startLine] - state.blkIndent >= 4) return false

  const opening = state.src.slice(start, max).trim()
  if (!opening.startsWith('$$')) return false

  // One-line display math must occupy the whole paragraph.
  if (opening.length > 4 && opening.endsWith('$$')) {
    if (silent) return true
    const token = state.push('math_block', 'math', 0)
    token.content = opening.slice(2, -2).trim()
    token.map = [startLine, startLine + 1]
    state.line = startLine + 1
    return true
  }

  if (opening !== '$$') return false
  let nextLine = startLine + 1
  while (nextLine < endLine) {
    const lineStart = state.bMarks[nextLine] + state.tShift[nextLine]
    const lineEnd = state.eMarks[nextLine]
    if (state.src.slice(lineStart, lineEnd).trim() === '$$') break
    nextLine += 1
  }
  if (nextLine >= endLine) return false
  if (silent) return true

  const token = state.push('math_block', 'math', 0)
  token.content = state.getLines(startLine + 1, nextLine, state.blkIndent, false)
  token.map = [startLine, nextLine + 1]
  state.line = nextLine + 1
  return true
})

markdownIt.inline.ruler.before('emphasis', 'lucent-inline-math', (state, silent) => {
  const start = state.pos
  if (state.src.charCodeAt(start) !== 0x24 /* $ */) return false
  if (state.src.charCodeAt(start + 1) === 0x24) return false
  if (start > 0 && state.src.charCodeAt(start - 1) === 0x5c /* \\ */) return false

  const end = state.src.indexOf('$', start + 1)
  if (end < 0) return false
  const source = state.src.slice(start + 1, end)
  if (!source || /[\n\r]/.test(source) || /^\s|\s$/.test(source)) return false
  if (state.src.charCodeAt(end - 1) === 0x5c /* \\ */) return false

  if (!silent) {
    const token = state.push('math_inline', 'math', 0)
    token.content = source
  }
  state.pos = end + 1
  return true
})

/**
 * markdown-it's CommonMark preset intentionally doesn't implement GFM task
 * lists. Keep the small normalization here so AI insertion and plain-text
 * paste share exactly the same list representation as imports and export.
 */
markdownIt.core.ruler.after('inline', 'lucent-task-lists', (state) => {
  type ListRecord = {
    open: (typeof state.tokens)[number]
    close: (typeof state.tokens)[number] | null
    items: Array<{ open: (typeof state.tokens)[number]; checked: boolean | null }>
  }

  const lists: ListRecord[] = []
  const items: Array<{
    record: ListRecord
    item: ListRecord['items'][number]
    seenInline: boolean
  }> = []

  for (const token of state.tokens) {
    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      lists.push({ open: token, close: null, items: [] })
      continue
    }

    if (token.type === 'list_item_open') {
      const record = lists.at(-1)
      if (!record) continue
      const item = { open: token, checked: null }
      record.items.push(item)
      items.push({ record, item, seenInline: false })
      continue
    }

    if (token.type === 'inline') {
      const active = items.at(-1)
      if (!active || active.seenInline) continue
      active.seenInline = true

      const marker = /^\[([ xX])\][ \t]+/
      const match = token.content.match(marker)
      if (!match) continue

      active.item.checked = match[1].toLowerCase() === 'x'
      token.content = token.content.slice(match[0].length)
      const firstChild = token.children?.[0]
      if (firstChild?.type === 'text') {
        firstChild.content = firstChild.content.replace(marker, '')
      }
      continue
    }

    if (token.type === 'list_item_close') {
      items.pop()
      continue
    }

    if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      const record = lists.pop()
      if (!record) continue
      record.close = token
      if (!record.items.some((item) => item.checked !== null)) continue

      // Lucent currently has one checklist presentation, so ordered task
      // markers normalize to the supported unordered checklist type.
      record.open.type = 'bullet_list_open'
      record.open.tag = 'ul'
      record.open.attrSet('data-list-kind', 'task')
      record.close.type = 'bullet_list_close'
      record.close.tag = 'ul'

      for (const item of record.items) {
        item.open.attrSet('data-checked', String(item.checked ?? false))
      }
    }
  }

  return true
})

const markdownParser = new MarkdownParser(schema, markdownIt, {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  math_block: {
    node: 'math_block',
    getAttrs(token) {
      return { latex: token.content }
    },
  },
  list_item: {
    block: 'list_item',
    getAttrs(token) {
      const checked = token.attrGet('data-checked')
      return { checked: checked === null ? null : checked === 'true' }
    },
  },
  bullet_list: {
    block: 'bullet_list',
    getAttrs(token) {
      return { kind: token.attrGet('data-list-kind') === 'task' ? 'task' : 'bullet' }
    },
  },
  ordered_list: {
    block: 'ordered_list',
    getAttrs(token) {
      const start = token.attrGet('start')
      return { order: start ? Number(start) : 1 }
    },
  },
  heading: {
    block: 'heading',
    getAttrs(token) {
      return { level: Number(token.tag.slice(1)) }
    },
  },
  code_block: { block: 'code_block', noCloseToken: true },
  fence: {
    block: 'code_block',
    noCloseToken: true,
    getAttrs(token) {
      const info = token.info?.trim()
      if (!info) return null
      const language = info.split(/\s+/)[0] ?? ''
      return language ? { language } : null
    },
  },
  hr: { node: 'horizontal_rule' },
  image: {
    node: 'image',
    getAttrs(token) {
      return {
        src: token.attrGet('src'),
        title: token.attrGet('title') ?? null,
        alt: token.attrGet('alt') ?? null,
      }
    },
  },
  hardbreak: { node: 'hard_break' },
  em: { mark: 'em' },
  strong: { mark: 'strong' },
  link: {
    mark: 'link',
    getAttrs(token) {
      return {
        href: token.attrGet('href'),
        title: token.attrGet('title') ?? null,
      }
    },
  },
  code_inline: { mark: 'code' },
  math_inline: {
    node: 'math_inline',
    getAttrs(token) {
      return { latex: token.content }
    },
  },
})

// Notes deliberately share inline Markdown and math semantics with documents,
// while remaining a compact surface without display equations or list nodes.
const noteMarkdownIt = new MarkdownIt('commonmark', {
  html: false,
  linkify: true,
  breaks: true,
})

noteMarkdownIt.inline.ruler.before('emphasis', 'lucent-inline-math', (state, silent) => {
  const start = state.pos
  if (state.src.charCodeAt(start) !== 0x24 /* $ */) return false
  if (state.src.charCodeAt(start + 1) === 0x24) return false
  if (start > 0 && state.src.charCodeAt(start - 1) === 0x5c /* \\ */) return false

  const end = state.src.indexOf('$', start + 1)
  if (end < 0) return false
  const source = state.src.slice(start + 1, end)
  if (!source || /[\n\r]/.test(source) || /^\s|\s$/.test(source)) return false
  if (state.src.charCodeAt(end - 1) === 0x5c /* \\ */) return false

  if (!silent) {
    const token = state.push('math_inline', 'math', 0)
    token.content = source
  }
  state.pos = end + 1
  return true
})

const noteMarkdownParser = new MarkdownParser(noteSchema, noteMarkdownIt, {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  heading: {
    block: 'heading',
    getAttrs(token) {
      return { level: Number(token.tag.slice(1)) }
    },
  },
  code_block: { block: 'code_block', noCloseToken: true },
  fence: { block: 'code_block', noCloseToken: true },
  hr: { node: 'horizontal_rule' },
  image: {
    node: 'image',
    getAttrs(token) {
      return {
        src: token.attrGet('src'),
        title: token.attrGet('title') ?? null,
        alt: token.attrGet('alt') ?? null,
      }
    },
  },
  hardbreak: { node: 'hard_break' },
  em: { mark: 'em' },
  strong: { mark: 'strong' },
  link: {
    mark: 'link',
    getAttrs(token) {
      return { href: token.attrGet('href'), title: token.attrGet('title') ?? null }
    },
  },
  code_inline: { mark: 'code' },
  math_inline: {
    node: 'math_inline',
    getAttrs(token) {
      return { latex: token.content }
    },
  },
})

function fragmentFromPlainText(text: string, target: 'document' | 'note'): Fragment {
  const normalized = text.replace(/\r\n?/g, '\n')
  if (!normalized) {
    return Fragment.empty
  }

  const targetSchema = target === 'note' ? noteSchema : schema
  const paragraphType = targetSchema.nodes.paragraph
  const hardBreakType = targetSchema.nodes.hard_break

  const blocks = normalized.split(/\n{2,}/)
  const nodes: ProseMirrorNode[] = []

  for (const block of blocks) {
    const lines = block.split('\n')
    const content: ProseMirrorNode[] = []

    lines.forEach((line, index) => {
      if (line.length > 0) {
        content.push(schema.text(line))
      }
      if (index < lines.length - 1 && hardBreakType) {
        content.push(hardBreakType.create())
      }
    })

    nodes.push(paragraphType.create(null, content))
  }

  return Fragment.fromArray(nodes)
}

function toSliceContent(markdownish: string, target: 'document' | 'note' = 'document'): Fragment {
  const normalized = markdownish.replace(/\r\n?/g, '\n')

  if (!normalized) {
    return Fragment.empty
  }

  try {
    const parsedDoc = (target === 'note' ? noteMarkdownParser : markdownParser).parse(normalized)
    if (parsedDoc.content.size > 0) {
      return parsedDoc.content
    }
  } catch {
    return fragmentFromPlainText(normalized, target)
  }

  return fragmentFromPlainText(normalized, target)
}

const RECOGNIZED_BLOCK_TOKENS = new Set([
  'blockquote_open',
  'bullet_list_open',
  'ordered_list_open',
  'heading_open',
  'code_block',
  'fence',
  'hr',
  'math_block',
])
const RECOGNIZED_INLINE_TOKENS = new Set([
  'math_inline',
  'strong_open',
  'em_open',
  'link_open',
  'image',
  'code_inline',
  'hardbreak',
])

/** True when plain clipboard text contains syntax worth upgrading to Markdown. */
export function hasRecognizedMarkdownSyntax(
  markdownish: string,
  target: 'document' | 'note' = 'document'
): boolean {
  const parser = target === 'note' ? noteMarkdownIt : markdownIt
  const tokens = parser.parse(markdownish.replace(/\r\n?/g, '\n'), {})
  return tokens.some(
    (token) =>
      RECOGNIZED_BLOCK_TOKENS.has(token.type) ||
      Boolean(token.children?.some((child) => RECOGNIZED_INLINE_TOKENS.has(child.type)))
  )
}

function resolveOpenDepth(content: Fragment, shouldOpen: boolean, side: 'start' | 'end'): number {
  if (!shouldOpen || content.childCount === 0) {
    return 0
  }

  const boundaryNode = side === 'start' ? content.firstChild : content.lastChild
  if (!boundaryNode || boundaryNode.type !== schema.nodes.paragraph) {
    return 0
  }

  return 1
}

export function parseMarkdownishToFragment(markdownish: string): Fragment {
  return toSliceContent(markdownish)
}

export function parseMarkdownishToSlice(
  markdownish: string,
  options: MarkdownishSliceOptions = {}
): Slice {
  const content = toSliceContent(markdownish, options.target)
  const openStart = resolveOpenDepth(content, options.openStart ?? false, 'start')
  const openEnd = resolveOpenDepth(content, options.openEnd ?? false, 'end')

  return new Slice(content, openStart, openEnd)
}
