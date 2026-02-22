import { rm, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const projectRoot = resolve(__dirname, '..', '..', '..')

export default async function globalSetup() {
  const configuredDataDir = process.env.PLOTLINE_DATA_DIR ?? 'data-test'
  const testDbDir = resolve(projectRoot, configuredDataDir)

  await rm(testDbDir, { recursive: true, force: true })
  await mkdir(testDbDir, { recursive: true })
}
