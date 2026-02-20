import { rm, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const projectRoot = resolve(__dirname, '..', '..', '..')
const testDbDir = resolve(projectRoot, 'data-test')
const lanceDir = resolve(testDbDir, 'lancedb')

export default async function globalSetup() {
  await rm(lanceDir, { recursive: true, force: true })
  await mkdir(testDbDir, { recursive: true })
}
