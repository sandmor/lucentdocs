import { LANGUAGE_ALIASES, normalizeLanguage, PLAIN_LANGUAGE } from '@/lib/code-block-language-id'
import { AVAILABLE_LANGUAGES, isAvailableLanguage } from '@/lib/refractor-languages'

export { LANGUAGE_ALIASES, PLAIN_LANGUAGE }

const DISPLAY_NAMES: Record<string, string> = {
  plain: 'Plain Text',
  markup: 'HTML',
  aspnet: 'ASP.NET',
  autohotkey: 'AutoHotkey',
  bbcode: 'BBCode',
  cilkc: 'Cilk C',
  cilkcpp: 'Cilk C++',
  clike: 'C-like',
  cpp: 'C++',
  csharp: 'C#',
  dataweave: 'DataWeave',
  editorconfig: 'EditorConfig',
  fsharp: 'F#',
  graphql: 'GraphQL',
  ignore: '.ignore',
  javadoc: 'JavaDoc',
  javadoclike: 'JavaDoc-like',
  javastacktrace: 'Java Stacktrace',
  jsdoc: 'JSDoc',
  jsstacktrace: 'JS Stacktrace',
  nand2tetris: 'Nand2Tetris',
  'nand2tetris-hdl': 'Nand2Tetris HDL',
  objectivec: 'Objective-C',
  opencl: 'OpenCL',
  openqasm: 'OpenQASM',
  pcaxis: 'PC-Axis',
  peoplecode: 'PeopleCode',
  phpdoc: 'PHPDoc',
  'plant-uml': 'PlantUML',
  powerquery: 'Power Query',
  powershell: 'PowerShell',
  promql: 'PromQL',
  purebasic: 'PureBasic',
  qsharp: 'Q#',
  robotframework: 'Robot Framework',
  supercollider: 'SuperCollider',
  systemd: 'systemd',
  't4-cs': 'T4 C#',
  't4-vb': 'T4 VB',
  uorazor: 'UO Razor',
  vbnet: 'VB.NET',
  wasm: 'Wasm',
}

const ACRONYMS = new Set([
  'abap',
  'abnf',
  'apl',
  'aql',
  'asm6502',
  'bbj',
  'bnf',
  'bqn',
  'bsl',
  'c',
  'cf',
  'cil',
  'cobol',
  'css',
  'csv',
  'd',
  'dax',
  'dns',
  'ebnf',
  'ejs',
  'erb',
  'ftl',
  'gd',
  'glsl',
  'gml',
  'gn',
  'hcl',
  'hdl',
  'hlsl',
  'hpkp',
  'hsts',
  'html',
  'http',
  'icu',
  'idl',
  'iecst',
  'ini',
  'j',
  'jq',
  'js',
  'json',
  'json5',
  'jsonp',
  'jsx',
  'llvm',
  'lolcode',
  'n1ql',
  'n4js',
  'nasm',
  'nginx',
  'nsis',
  'php',
  'plsql',
  'q',
  'qml',
  'r',
  'rest',
  'sas',
  'scss',
  'sml',
  'sparql',
  'spl',
  'sqf',
  'sql',
  'tcl',
  'toml',
  'ts',
  'tsx',
  'tt2',
  'uri',
  'wgsl',
  'xml',
  'yaml',
])

const PICKER_LANGUAGES = AVAILABLE_LANGUAGES.filter(
  (lang) => normalizeLanguage(lang) === lang && lang !== PLAIN_LANGUAGE
)

export { normalizeLanguage }

export function isHighlightableLanguage(language: string | null | undefined): boolean {
  return isAvailableLanguage(language)
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

  // Smartly format multi-word strings (e.g. 'js-extras' -> 'JS Extras', 'shell-session' -> 'Shell Session')
  if (normalized.includes('-')) {
    return normalized
      .split('-')
      .map((part) => {
        if (ACRONYMS.has(part)) return part.toUpperCase()
        return part.charAt(0).toUpperCase() + part.slice(1)
      })
      .join(' ')
  }

  // Handle distinct acronyms
  if (ACRONYMS.has(normalized)) return normalized.toUpperCase()

  // Catch dynamic `*script` languages (handles TypeScript, JavaScript, GDScript, etc.)
  if (normalized.endsWith('script')) {
    const prefix = normalized.slice(0, -6)
    if (!prefix) return 'Script'

    const formattedPrefix = ACRONYMS.has(prefix)
      ? prefix.toUpperCase()
      : prefix.charAt(0).toUpperCase() + prefix.slice(1)

    return formattedPrefix + 'Script'
  }

  // Fallback to standard Title Case
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

export function getBundledLanguages(): readonly string[] {
  return AVAILABLE_LANGUAGES
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
