import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(root, '..')
const langDir = path.join(webRoot, 'node_modules/refractor/lang')
const manifestFile = path.join(webRoot, 'src/lib/refractor-language-manifest.ts')
const loadersFile = path.join(webRoot, 'src/lib/refractor-language-loaders.generated.ts')

const ids = fs
  .readdirSync(langDir)
  .filter((file) => file.endsWith('.js'))
  .map((file) => file.slice(0, -3))
  .sort()

const manifestSource = `// Generated from refractor/lang; re-run: bun run generate:refractor-manifest
export const REFRACTOR_LANGUAGE_IDS = ${JSON.stringify(ids)} as const
`

const loaderLines = ids.map(
  (id) =>
    `  ${JSON.stringify(id)}: () => import('../../node_modules/refractor/lang/${id}.js').then((module) => module.default),`
)

const loadersSource = `// Generated from refractor/lang; re-run: bun run generate:refractor-manifest
import type { Syntax } from 'refractor/core'

type GrammarLoader = () => Promise<Syntax>

export const refractorGrammarLoaders: Record<string, GrammarLoader> = {
${loaderLines.join('\n')}
}
`

fs.writeFileSync(manifestFile, manifestSource)
fs.writeFileSync(loadersFile, loadersSource)
console.log(
  `Wrote ${ids.length} refractor languages to ${path.relative(webRoot, manifestFile)} and ${path.relative(webRoot, loadersFile)}`
)
