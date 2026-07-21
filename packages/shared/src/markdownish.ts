import MarkdownIt from 'markdown-it'
import { MarkdownParser } from 'prosemirror-markdown'
import { Fragment, Slice, type Node as ProseMirrorNode } from 'prosemirror-model'
import { schema } from './schema.js'

export interface MarkdownishSliceOptions {
  openStart?: boolean
  openEnd?: boolean
}

const markdownIt = new MarkdownIt('commonmark', {
  html: false,
  linkify: true,
  breaks: true,
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
})

function fragmentFromPlainText(text: string): Fragment {
  const normalized = text.replace(/\r\n?/g, '\n')
  if (!normalized) {
    return Fragment.empty
  }

  const paragraphType = schema.nodes.paragraph
  const hardBreakType = schema.nodes.hard_break

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

function toSliceContent(markdownish: string): Fragment {
  const normalized = markdownish.replace(/\r\n?/g, '\n')

  if (!normalized) {
    return Fragment.empty
  }

  try {
    const parsedDoc = markdownParser.parse(normalized)
    if (parsedDoc.content.size > 0) {
      return parsedDoc.content
    }
  } catch {
    return fragmentFromPlainText(normalized)
  }

  return fragmentFromPlainText(normalized)
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
  const content = toSliceContent(markdownish)
  const openStart = resolveOpenDepth(content, options.openStart ?? false, 'start')
  const openEnd = resolveOpenDepth(content, options.openEnd ?? false, 'end')

  return new Slice(content, openStart, openEnd)
}
