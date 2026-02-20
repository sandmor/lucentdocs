import MarkdownIt from 'markdown-it'
import { MarkdownParser } from 'prosemirror-markdown'
import { Fragment, Slice, type Node as ProseMirrorNode } from 'prosemirror-model'
import { schema } from './schema'

const markdownIt = new MarkdownIt('commonmark', {
  html: false,
  linkify: true,
  breaks: true,
})

const markdownParser = new MarkdownParser(schema, markdownIt, {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: { block: 'list_item' },
  bullet_list: { block: 'bullet_list' },
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
      return {
        href: token.attrGet('href'),
        title: token.attrGet('title') ?? null,
      }
    },
  },
  code_inline: { mark: 'code' },
})

interface MarkdownishSliceOptions {
  openStart?: boolean
  openEnd?: boolean
}

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
