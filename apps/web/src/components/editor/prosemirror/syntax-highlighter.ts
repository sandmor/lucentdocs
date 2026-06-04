import { toHtml } from 'hast-util-to-html'
import { refractor } from 'refractor'
import { isHighlightableLanguage, normalizeLanguage } from '../nodes/code-block-languages'

const HTML_ESCAPE_REGEX = /[&<>"']/g

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(text: string): string {
  return text.replace(HTML_ESCAPE_REGEX, (char) => HTML_ESCAPE_MAP[char] ?? char)
}

export function getHighlightedHTML(code: string, language: string | null | undefined): string {
  if (!isHighlightableLanguage(language)) {
    return escapeHtml(code)
  }

  const normalized = normalizeLanguage(language)

  try {
    const tree = refractor.highlight(code, normalized)
    return toHtml(tree)
  } catch (error) {
    console.warn(`Failed to highlight code with language ${normalized}:`, error)
    return escapeHtml(code)
  }
}
