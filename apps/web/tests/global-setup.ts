import { rm, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const projectRoot = resolve(__dirname, '..', '..', '..')
const testDbDir = resolve(projectRoot, 'data-test')
const sqliteFile = resolve(testDbDir, 'sqlite.db')

export default async function globalSetup() {
  await rm(sqliteFile, { force: true })
  await mkdir(testDbDir, { recursive: true })
}
