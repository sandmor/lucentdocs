import { toHtml } from 'hast-util-to-html'
import { ensureLanguageLoaded, refractor } from '@/lib/refractor-languages'
import { normalizeLanguage, PLAIN_LANGUAGE } from '@/lib/code-block-language-id'

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

function highlightRegistered(code: string, normalized: string): string {
  try {
    const tree = refractor.highlight(code, normalized)
    return toHtml(tree)
  } catch (error) {
    console.warn(`Failed to highlight code with language ${normalized}:`, error)
    return escapeHtml(code)
  }
}

export function getHighlightedHTML(code: string, language: string | null | undefined): string {
  const normalized = normalizeLanguage(language)
  if (normalized === PLAIN_LANGUAGE || !refractor.registered(normalized)) {
    return escapeHtml(code)
  }

  return highlightRegistered(code, normalized)
}

export async function getHighlightedHTMLAsync(
  code: string,
  language: string | null | undefined
): Promise<string> {
  const normalized = normalizeLanguage(language)
  if (normalized === PLAIN_LANGUAGE) {
    return escapeHtml(code)
  }

  const loaded = await ensureLanguageLoaded(language)
  if (!loaded || !refractor.registered(normalized)) {
    return escapeHtml(code)
  }

  return highlightRegistered(code, normalized)
}
