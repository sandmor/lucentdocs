import { refractor } from 'refractor'

export const PLAIN_LANGUAGE = 'plain'

export const LANGUAGE_ALIASES: Record<string, string> = {
  text: PLAIN_LANGUAGE,
  plain: PLAIN_LANGUAGE,
  plaintext: PLAIN_LANGUAGE,
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  md: 'markdown',
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  cs: 'csharp',
  dotnet: 'csharp',
  kt: 'kotlin',
  kts: 'kotlin',
  rb: 'ruby',
  objc: 'objectivec',
}

const DISPLAY_NAMES: Record<string, string> = {
  plain: 'Plain Text',
  markup: 'HTML',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  css: 'CSS',
  json: 'JSON',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
  bash: 'Bash',
  markdown: 'Markdown',
  sql: 'SQL',
  java: 'Java',
  kotlin: 'Kotlin',
  csharp: 'C#',
  cpp: 'C++',
  c: 'C',
  yaml: 'YAML',
  php: 'PHP',
  ruby: 'Ruby',
  swift: 'Swift',
  lua: 'Lua',
  perl: 'Perl',
  sass: 'Sass',
  scss: 'SCSS',
  less: 'Less',
  diff: 'Diff',
  ini: 'INI',
  makefile: 'Makefile',
  vbnet: 'VB.NET',
  arduino: 'Arduino',
  objectivec: 'Objective-C',
  regex: 'Regex',
}

const ACRONYMS = new Set(['css', 'json', 'sql', 'php', 'yaml', 'ini', 'cpp'])

const BUNDLED_LANGUAGES = [...refractor.listLanguages()].sort()

export function normalizeLanguage(language: string | null | undefined): string {
  if (!language?.trim()) return PLAIN_LANGUAGE
  const lower = language.toLowerCase().trim().split(/\s+/)[0] ?? ''
  return LANGUAGE_ALIASES[lower] ?? lower
}

const PICKER_LANGUAGES = BUNDLED_LANGUAGES.filter(
  (lang) => normalizeLanguage(lang) === lang && lang !== PLAIN_LANGUAGE
)

export function isHighlightableLanguage(language: string | null | undefined): boolean {
  if (!language?.trim()) return false
  const normalized = normalizeLanguage(language)
  if (normalized === PLAIN_LANGUAGE) return false
  return refractor.registered(normalized)
}

export function toStoredLanguage(language: string): string {
  return language === PLAIN_LANGUAGE ? '' : language
}

export function fromStoredLanguage(language: string | null | undefined): string {
  return language?.trim() ? language : PLAIN_LANGUAGE
}

export function toPickerValue(language: string | null | undefined): string {
  const stored = language?.trim()
  if (!stored) return PLAIN_LANGUAGE

  const normalized = normalizeLanguage(stored)
  if (normalized === PLAIN_LANGUAGE) return PLAIN_LANGUAGE
  if (PICKER_LANGUAGES.includes(normalized)) return normalized

  return stored
}

export function toCanonicalStoredLanguage(pickerValue: string): string {
  if (pickerValue === PLAIN_LANGUAGE) return PLAIN_LANGUAGE
  return pickerValue
}

export function formatLanguageName(language: string): string {
  const normalized = normalizeLanguage(language)
  if (normalized === PLAIN_LANGUAGE) return DISPLAY_NAMES.plain
  if (DISPLAY_NAMES[normalized]) return DISPLAY_NAMES[normalized]!
  if (ACRONYMS.has(normalized)) return normalized.toUpperCase()
  if (normalized.endsWith('script')) {
    const prefix = normalized.slice(0, -6)
    if (!prefix) return 'Script'
    return prefix.charAt(0).toUpperCase() + prefix.slice(1) + 'Script'
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

export function getBundledLanguages(): readonly string[] {
  return BUNDLED_LANGUAGES
}

export interface LanguagePickerOption {
  value: string
  label: string
  unsupported?: boolean
}

export function getLanguagePickerOptions(currentLanguage?: string): LanguagePickerOption[] {
  const options: LanguagePickerOption[] = [
    { value: PLAIN_LANGUAGE, label: DISPLAY_NAMES.plain },
    ...PICKER_LANGUAGES.map((language) => ({
      value: language,
      label: formatLanguageName(language),
    })),
  ]

  const stored = currentLanguage?.trim()
  if (!stored) return options

  const pickerValue = toPickerValue(stored)
  const known =
    pickerValue === PLAIN_LANGUAGE ||
    PICKER_LANGUAGES.includes(pickerValue) ||
    options.some((option) => option.value === stored)

  if (!known) {
    options.push({
      value: stored,
      label: formatLanguageName(stored),
      unsupported: true,
    })
  }

  return options
}
