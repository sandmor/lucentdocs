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

export function normalizeLanguage(language: string | null | undefined): string {
  if (!language?.trim()) return PLAIN_LANGUAGE
  const lower = language.toLowerCase().trim().split(/\s+/)[0] ?? ''
  return LANGUAGE_ALIASES[lower] ?? lower
}
