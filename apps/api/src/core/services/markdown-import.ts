import { parseFragment, serialize } from 'parse5'

export type MarkdownImportHtmlMode = 'keep' | 'convert_basic' | 'preserve_blocks'

export type MarkdownSplitStrategy =
  | { type: 'none' }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: 'size' }

export interface MarkdownImportPlanOptions {
  maxDocChars: number
  targetDocChars?: number
  split: MarkdownSplitStrategy
  htmlMode?: MarkdownImportHtmlMode
}

export interface MarkdownImportPlanPart {
  markdown: string
  suggestedTitle: string | null
  estimatedChars: number
}

export interface MarkdownHtmlDetection {
  htmlTagCount: number
  tags: Record<string, number>
  hasLikelyHtmlBlocks: boolean
}

function normalizeNewlines(input: string): string {
  return input.replace(/\r\n?/g, '\n')
}

function isFenceLine(line: string): { marker: '```' | '~~~'; length: number } | null {
  const trimmed = line.trimStart()
  const match = /^(?<marker>`{3,}|~{3,})/.exec(trimmed)
  if (!match?.groups?.marker) return null
  const marker = match.groups.marker.startsWith('`') ? '```' : '~~~'
  return { marker, length: match.groups.marker.length }
}

function splitLinesPreserveNewlines(text: string): string[] {
  if (!text) return []
  const normalized = normalizeNewlines(text)
  return normalized.split('\n')
}

function extractYamlFrontmatter(markdown: string): { frontmatter: string; body: string } {
  const normalized = normalizeNewlines(markdown)
  if (!normalized.startsWith('---\n') && normalized.trim() !== '---') {
    return { frontmatter: '', body: normalized }
  }

  const lines = splitLinesPreserveNewlines(normalized)
  if (lines.length === 0) return { frontmatter: '', body: normalized }
  if (lines[0]?.trim() !== '---') return { frontmatter: '', body: normalized }

  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      const frontmatter = lines.slice(0, i + 1).join('\n') + '\n'
      const body = lines.slice(i + 1).join('\n')
      return { frontmatter, body }
    }
  }

  return { frontmatter: '', body: normalized }
}

function parseAtxHeading(line: string): { level: 1 | 2 | 3 | 4 | 5 | 6; text: string } | null {
  const match = /^(?<hashes>#{1,6})\s+(?<text>.*)$/.exec(line)
  if (!match?.groups?.hashes || match.groups.text == null) return null
  const level = match.groups.hashes.length as 1 | 2 | 3 | 4 | 5 | 6
  const text = match.groups.text.replace(/\s+#+\s*$/, '').trim()
  return { level, text }
}

function stripInlineMarkdownNoise(text: string): string {
  return text
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .trim()
}

function chooseBacktickFence(content: string, minLength = 3): string {
  let maxRun = 0
  for (const match of content.matchAll(/`+/g)) {
    maxRun = Math.max(maxRun, match[0].length)
  }
  return '`'.repeat(Math.max(minLength, maxRun + 1))
}

function escapeMarkdownLabel(text: string): string {
  return text.replace(/[[\]\\]/g, '\\$&')
}

function escapeMarkdownLinkDestination(url: string): string {
  const collapsedWhitespace = url.trim().replace(/\s+/g, '%20')
  return collapsedWhitespace.replace(/[()\\]/g, '\\$&')
}

function escapeMarkdownTitle(title: string): string {
  return title
    .replace(/\r\n?/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .trim()
}

export function detectHtmlInMarkdown(markdown: string): MarkdownHtmlDetection {
  const lines = splitLinesPreserveNewlines(markdown)
  let inFence: { marker: '```' | '~~~'; length: number } | null = null

  let htmlTagCount = 0
  const tags: Record<string, number> = {}
  let hasLikelyHtmlBlocks = false

  for (const line of lines) {
    const fence = isFenceLine(line)
    if (fence) {
      if (!inFence) {
        inFence = fence
      } else if (inFence.marker === fence.marker && fence.length >= inFence.length) {
        inFence = null
      }
      continue
    }

    if (inFence) continue

    const trimmed = line.trim()
    if (trimmed.startsWith('<') && trimmed.endsWith('>') && trimmed.length >= 3) {
      hasLikelyHtmlBlocks = true
    }

    const tagRegex = /<\s*\/?\s*([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g
    for (const match of trimmed.matchAll(tagRegex)) {
      const tag = match[1]?.toLowerCase()
      if (!tag) continue
      htmlTagCount++
      tags[tag] = (tags[tag] ?? 0) + 1
    }
  }

  return { htmlTagCount, tags, hasLikelyHtmlBlocks }
}

function isLikelyHtmlBlockLine(line: string): boolean {
  const trimmedStart = line.trimStart()
  if (!trimmedStart.startsWith('<')) return false
  if (!trimmedStart.includes('>')) return false
  const collapsed = trimmedStart.trim()
  if (collapsed.startsWith('<!--') && collapsed.includes('-->')) return true

  const commonBlockTag =
    /^<\s*\/?\s*(p|div|table|thead|tbody|tfoot|tr|td|th|ul|ol|li|blockquote|pre|code|img|a|h[1-6]|section|article|details|summary|figure|figcaption)\b/i
  if (commonBlockTag.test(collapsed)) return true

  // Fallback: accept tag-only lines.
  return /^<\s*\/?\s*[a-zA-Z][a-zA-Z0-9-]*\b[^>]*>\s*$/.test(collapsed)
}

type Parse5Node = any

function isParse5Text(node: Parse5Node): node is { nodeName: '#text'; value: string } {
  return node?.nodeName === '#text' && typeof node.value === 'string'
}

function isParse5Element(
  node: Parse5Node
): node is { tagName: string; attrs?: any[]; childNodes?: any[] } {
  return typeof node?.tagName === 'string'
}

function parse5Attr(node: Parse5Node, name: string): string | null {
  const attrs = (node?.attrs ?? []) as Array<{ name: string; value: string }>
  const match = attrs.find((a) => a.name.toLowerCase() === name.toLowerCase())
  return match?.value ?? null
}

function parse5TextContent(node: Parse5Node): string {
  if (isParse5Text(node)) return node.value
  if (isParse5Element(node)) {
    return ((node.childNodes ?? []) as Parse5Node[]).map(parse5TextContent).join('')
  }
  const children = (node?.childNodes ?? []) as Parse5Node[]
  if (Array.isArray(children) && children.length > 0) {
    return children.map(parse5TextContent).join('')
  }
  return ''
}

function isUnsafeOrUnsupportedHtmlContainer(tag: string): boolean {
  return (
    tag === 'table' ||
    tag === 'thead' ||
    tag === 'tbody' ||
    tag === 'tfoot' ||
    tag === 'tr' ||
    tag === 'td' ||
    tag === 'th' ||
    tag === 'details' ||
    tag === 'summary' ||
    tag === 'iframe' ||
    tag === 'script' ||
    tag === 'style' ||
    tag === 'object' ||
    tag === 'embed'
  )
}

function renderInlineFromHtmlNode(node: Parse5Node): string {
  if (isParse5Text(node)) return node.value
  if (!isParse5Element(node)) {
    const children = (node?.childNodes ?? []) as Parse5Node[]
    return children.map(renderInlineFromHtmlNode).join('')
  }

  const tag = node.tagName.toLowerCase()
  const children = (node.childNodes ?? []) as Parse5Node[]

  if (tag === 'br') return '\\\n'
  if (tag === 'strong' || tag === 'b')
    return `**${children.map(renderInlineFromHtmlNode).join('')}**`
  if (tag === 'em' || tag === 'i') return `*${children.map(renderInlineFromHtmlNode).join('')}*`
  if (tag === 'code') return `\`${children.map(renderInlineFromHtmlNode).join('')}\``
  if (tag === 'a') {
    const href = parse5Attr(node, 'href') ?? parse5Attr(node, 'data-href')
    const text = children.map(renderInlineFromHtmlNode).join('').trim()
    if (!href) return text
    const label = escapeMarkdownLabel(text || href)
    const destination = escapeMarkdownLinkDestination(href)
    return `[${label}](${destination})`
  }
  if (tag === 'img') {
    const src = parse5Attr(node, 'src') ?? parse5Attr(node, 'data-src')
    if (!src) return ''
    const alt = parse5Attr(node, 'alt') ?? ''
    const title = parse5Attr(node, 'title')
    const titleSuffix = title ? ` "${escapeMarkdownTitle(title)}"` : ''
    return `![${escapeMarkdownLabel(alt)}](${escapeMarkdownLinkDestination(src)}${titleSuffix})`
  }

  return children.map(renderInlineFromHtmlNode).join('')
}

function renderBlockFromHtmlNode(node: Parse5Node, indent: string = ''): string {
  if (isParse5Text(node)) return node.value
  if (!isParse5Element(node)) {
    const children = (node?.childNodes ?? []) as Parse5Node[]
    return children.map((child) => renderBlockFromHtmlNode(child, indent)).join('')
  }

  const tag = node.tagName.toLowerCase()
  const children = (node.childNodes ?? []) as Parse5Node[]

  if (isUnsafeOrUnsupportedHtmlContainer(tag)) {
    const html = serialize(node as any)
    const fence = chooseBacktickFence(html)
    return `${indent}${fence}html\n${html}\n${indent}${fence}\n\n`
  }

  if (tag === 'pre') {
    let language: string | null = null
    const codeChild = children.find((c) => isParse5Element(c) && c.tagName.toLowerCase() === 'code')
    if (codeChild && isParse5Element(codeChild)) {
      const classAttr = parse5Attr(codeChild, 'class') ?? ''
      const match = /\blanguage-([a-z0-9_-]+)\b/i.exec(classAttr)
      if (match?.[1]) language = match[1]
    }
    const codeText = codeChild ? parse5TextContent(codeChild) : parse5TextContent(node)
    const fence = chooseBacktickFence(codeText)
    const info = language ?? ''
    return `${indent}${fence}${info}\n${codeText.replace(/\n$/, '')}\n${indent}${fence}\n\n`
  }

  if (tag === 'img') {
    const inline = renderInlineFromHtmlNode(node).trim()
    return inline ? `${indent}${inline}\n\n` : ''
  }

  if (tag === 'blockquote') {
    const inner = children
      .map((c) => renderBlockFromHtmlNode(c, indent))
      .join('')
      .trim()
    const quoted = inner
      .split('\n')
      .map((line) => (line.length > 0 ? `> ${line}` : '>'))
      .join('\n')
    return `${indent}${quoted}\n\n`
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1))
    const hashes = '#'.repeat(Math.min(6, Math.max(1, level)))
    const text = children.map(renderInlineFromHtmlNode).join('').trim()
    return `${indent}${hashes} ${text}\n\n`
  }

  if (tag === 'hr') return `${indent}---\n\n`

  if (tag === 'ul' || tag === 'ol') {
    const isOrdered = tag === 'ol'
    const items = children.filter(
      (c) => isParse5Element(c) && c.tagName.toLowerCase() === 'li'
    ) as Parse5Node[]
    const lines: string[] = []
    items.forEach((li, index) => {
      const bullet = isOrdered ? `${index + 1}.` : '-'
      const liChildren = (li.childNodes ?? []) as Parse5Node[]
      const textParts: string[] = []
      const nestedBlocks: string[] = []
      for (const child of liChildren) {
        if (
          isParse5Element(child) &&
          (child.tagName.toLowerCase() === 'ul' || child.tagName.toLowerCase() === 'ol')
        ) {
          nestedBlocks.push(renderBlockFromHtmlNode(child, indent + '  ').trimEnd())
        } else {
          textParts.push(renderInlineFromHtmlNode(child))
        }
      }
      const line = `${indent}${bullet} ${textParts.join('').trim()}`
      lines.push(line.trimEnd())
      if (nestedBlocks.length > 0) {
        lines.push(
          ...nestedBlocks
            .join('\n')
            .split('\n')
            .map((l) => (l ? `${indent}  ${l}` : l))
        )
      }
    })
    return `${lines.join('\n')}\n\n`
  }

  if (
    tag === 'p' ||
    tag === 'div' ||
    tag === 'section' ||
    tag === 'article' ||
    tag === 'header' ||
    tag === 'footer' ||
    tag === 'main' ||
    tag === 'aside'
  ) {
    const text = children.map(renderInlineFromHtmlNode).join('').trim()
    return text ? `${indent}${text}\n\n` : ''
  }

  const asInline = children.map(renderInlineFromHtmlNode).join('').trim()
  return asInline ? `${indent}${asInline}\n\n` : ''
}

function htmlToMarkdownBlock(html: string): string {
  const fragment = parseFragment(html) as Parse5Node
  const nodes = ((fragment as any).childNodes ?? []) as Parse5Node[]
  const rendered = nodes.map((n) => renderBlockFromHtmlNode(n)).join('')
  return rendered.replace(/\n{3,}/g, '\n\n').trim()
}

function htmlToMarkdownInline(html: string): string {
  const fragment = parseFragment(html) as Parse5Node
  const nodes = ((fragment as any).childNodes ?? []) as Parse5Node[]
  return nodes.map((n) => renderInlineFromHtmlNode(n)).join('')
}

function chooseNonCollidingMarker(haystack: string, base: string): string {
  let marker = base
  for (let i = 0; i < 50; i++) {
    if (!haystack.includes(marker)) return marker
    marker = `${base}_${i}`
  }
  return `${base}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`
}

function protectInlineCodeSpans(input: string): {
  text: string
  restore: (value: string) => string
} {
  const replacements: Array<{ token: string; original: string }> = []
  const marker = chooseNonCollidingMarker(input, '@@LUCENT_CODE_SPAN@@')
  let index = 0
  const text = input.replace(/(`+)([^`]*?)\1/g, (match) => {
    const token = `${marker}${index++}${marker}`
    replacements.push({ token, original: match })
    return token
  })

  const restore = (value: string) => {
    let restored = value
    for (const { token, original } of replacements) {
      restored = restored.split(token).join(original)
    }
    return restored
  }

  return { text, restore }
}

function protectMarkdownAutolinks(input: string): {
  text: string
  restore: (value: string) => string
} {
  const replacements: Array<{ token: string; original: string }> = []
  const marker = chooseNonCollidingMarker(input, '@@LUCENT_AUTOLINK@@')
  let index = 0
  const autolinkRegex = /<(https?:\/\/[^>\s]+|mailto:[^>\s]+|[^>\s@]+@[^>\s@]+)>/gi
  const text = input.replace(autolinkRegex, (match) => {
    const token = `${marker}${index++}${marker}`
    replacements.push({ token, original: match })
    return token
  })

  const restore = (value: string) => {
    let restored = value
    for (const { token, original } of replacements) {
      restored = restored.split(token).join(original)
    }
    return restored
  }

  return { text, restore }
}

function wrapHtmlBlocksAsFencedCode(markdown: string): string {
  const lines = splitLinesPreserveNewlines(markdown)
  let inFence: { marker: '```' | '~~~'; length: number } | null = null
  const out: string[] = []

  let htmlBlock: string[] | null = null
  const flushHtmlBlock = () => {
    if (!htmlBlock || htmlBlock.length === 0) return
    const html = htmlBlock.join('\n')
    const fence = chooseBacktickFence(html)
    out.push(`${fence}html`)
    out.push(...htmlBlock)
    out.push(fence)
    htmlBlock = null
  }

  for (const line of lines) {
    const fence = isFenceLine(line)
    if (fence) {
      flushHtmlBlock()
      if (!inFence) {
        inFence = fence
      } else if (inFence.marker === fence.marker && fence.length >= inFence.length) {
        inFence = null
      }
      out.push(line)
      continue
    }

    if (inFence) {
      flushHtmlBlock()
      out.push(line)
      continue
    }

    const trimmed = line.trim()
    if (!trimmed) {
      flushHtmlBlock()
      out.push(line)
      continue
    }

    if (isLikelyHtmlBlockLine(line)) {
      htmlBlock ??= []
      htmlBlock.push(line)
      continue
    }

    flushHtmlBlock()
    out.push(line)
  }

  flushHtmlBlock()
  return out.join('\n')
}

function convertHtmlBlocksToPlainText(markdown: string): string {
  const lines = splitLinesPreserveNewlines(markdown)
  let inFence: { marker: '```' | '~~~'; length: number } | null = null
  const out: string[] = []

  let htmlBlock: string[] | null = null
  const flushHtmlBlock = () => {
    if (!htmlBlock || htmlBlock.length === 0) return
    const joined = htmlBlock.join('\n')
    const converted = htmlToMarkdownBlock(joined)
    if (converted) out.push(converted)
    htmlBlock = null
  }

  for (const line of lines) {
    const fence = isFenceLine(line)
    if (fence) {
      flushHtmlBlock()
      if (!inFence) {
        inFence = fence
      } else if (inFence.marker === fence.marker && fence.length >= inFence.length) {
        inFence = null
      }
      out.push(line)
      continue
    }

    if (inFence) {
      flushHtmlBlock()
      out.push(line)
      continue
    }

    const trimmed = line.trim()
    if (!trimmed) {
      flushHtmlBlock()
      out.push(line)
      continue
    }

    if (isLikelyHtmlBlockLine(line)) {
      htmlBlock ??= []
      htmlBlock.push(line)
      continue
    }

    flushHtmlBlock()
    if (line.includes('<') && line.includes('>') && /<\s*\/?\s*[a-zA-Z]/.test(line)) {
      const protectedCode = protectInlineCodeSpans(line)
      const protectedLinks = protectMarkdownAutolinks(protectedCode.text)
      const converted = htmlToMarkdownInline(protectedLinks.text)
      out.push(protectedCode.restore(protectedLinks.restore(converted)))
      continue
    }

    out.push(line)
  }

  flushHtmlBlock()
  return out.join('\n')
}

export function normalizeHtmlInMarkdown(markdown: string, mode: MarkdownImportHtmlMode): string {
  if (mode === 'keep') return markdown
  if (mode === 'preserve_blocks') return wrapHtmlBlocksAsFencedCode(markdown)
  return convertHtmlBlocksToPlainText(markdown)
}

function splitByHeading(markdown: string, level: 1 | 2 | 3 | 4 | 5 | 6): string[] {
  const lines = splitLinesPreserveNewlines(markdown)
  let inFence: { marker: '```' | '~~~'; length: number } | null = null
  const boundaries: number[] = [0]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const fence = isFenceLine(line)
    if (fence) {
      if (!inFence) {
        inFence = fence
      } else if (inFence.marker === fence.marker && fence.length >= inFence.length) {
        inFence = null
      }
      continue
    }

    if (inFence) continue

    const heading = parseAtxHeading(line)
    if (heading && heading.level === level) {
      if (i !== 0) boundaries.push(i)
    }
  }

  boundaries.push(lines.length)
  const parts: string[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i] ?? 0
    const end = boundaries[i + 1] ?? lines.length
    const part = lines.slice(start, end).join('\n').trim()
    if (part) parts.push(part)
  }

  return parts
}

function splitBySize(markdown: string, targetChars: number, maxChars: number): string[] {
  const lines = splitLinesPreserveNewlines(markdown)
  let inFence: { marker: '```' | '~~~'; length: number } | null = null

  const parts: string[] = []
  let start = 0
  let lastBreak: number | null = null
  let accChars = 0

  const flush = (endExclusive: number) => {
    const chunk = lines.slice(start, endExclusive).join('\n').trim()
    if (chunk) parts.push(chunk)
    start = endExclusive
    lastBreak = null
    accChars = 0
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const fence = isFenceLine(line)
    if (fence) {
      if (!inFence) {
        inFence = fence
      } else if (inFence.marker === fence.marker && fence.length >= inFence.length) {
        inFence = null
      }
    }

    accChars += line.length + 1
    if (!inFence && line.trim() === '') {
      lastBreak = i + 1
    }

    const overTarget = accChars >= targetChars
    const overMax = accChars >= maxChars

    if (overMax) {
      if (lastBreak && lastBreak > start) {
        flush(lastBreak)
        i = start - 1
        continue
      }

      if (i > start) {
        flush(i)
        i = start - 1
        continue
      }

      const oversizedLine = lines[i] ?? ''
      if (oversizedLine.length === 0) {
        flush(i + 1)
        i = start - 1
        continue
      }

      for (let offset = 0; offset < oversizedLine.length; offset += maxChars) {
        const chunk = oversizedLine.slice(offset, offset + maxChars).trim()
        if (chunk) parts.push(chunk)
      }

      start = i + 1
      lastBreak = null
      accChars = 0
      continue
    }

    if (overTarget && lastBreak && lastBreak > start) {
      flush(lastBreak)
      i = start - 1
    }
  }

  if (start < lines.length) {
    flush(lines.length)
  }

  return parts
}

function suggestedTitleFromPart(markdown: string): string | null {
  const lines = splitLinesPreserveNewlines(markdown)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const heading = parseAtxHeading(trimmed)
    if (heading?.text) return stripInlineMarkdownNoise(heading.text) || null
    break
  }
  return null
}

export function planMarkdownImport(
  markdown: string,
  options: MarkdownImportPlanOptions
): {
  normalizedMarkdown: string
  parts: MarkdownImportPlanPart[]
  html: MarkdownHtmlDetection
} {
  const normalized = normalizeNewlines(markdown)
  const htmlMode = options.htmlMode ?? 'keep'
  const withHtmlHandled = normalizeHtmlInMarkdown(normalized, htmlMode)
  const html = detectHtmlInMarkdown(normalized)

  const { frontmatter, body } = extractYamlFrontmatter(withHtmlHandled)
  const hardMax = Math.max(1, options.maxDocChars)
  const target = Math.min(Math.max(1, options.targetDocChars ?? hardMax), hardMax)

  const initialParts =
    options.split.type === 'none'
      ? [body.trim()]
      : options.split.type === 'heading'
        ? splitByHeading(body, options.split.level)
        : splitBySize(body, target, hardMax)

  const partsAfterSizing: string[] = []
  for (const part of initialParts) {
    if (part.length <= hardMax) {
      partsAfterSizing.push(part)
      continue
    }
    partsAfterSizing.push(...splitBySize(part, target, hardMax))
  }

  const finalParts = partsAfterSizing.map((part, index) => {
    const withFrontmatter = index === 0 && frontmatter ? `${frontmatter}${part}` : part
    const trimmed = withFrontmatter.trim()
    return {
      markdown: trimmed,
      suggestedTitle: suggestedTitleFromPart(trimmed),
      estimatedChars: trimmed.length,
    } satisfies MarkdownImportPlanPart
  })

  return {
    normalizedMarkdown: withHtmlHandled,
    parts: finalParts.filter((p) => p.markdown.length > 0),
    html,
  }
}
