import { mkdir, rm } from 'fs/promises'
import { resolveDataDir } from '../paths.js'

process.env.LUCENTDOCS_TEST_MODE = '1'
process.env.NODE_ENV ??= 'test'
process.env.HOST ??= '127.0.0.1'
process.env.PORT ??= '5678'

const configuredDataDir = process.env.LUCENTDOCS_TEST_DATA_DIR?.trim() || 'data-test'
process.env.LUCENTDOCS_DATA_DIR = configuredDataDir
const dataDir = resolveDataDir(configuredDataDir)

await rm(dataDir, { recursive: true, force: true })
await mkdir(dataDir, { recursive: true })
