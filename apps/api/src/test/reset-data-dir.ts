import { mkdir, rm } from 'fs/promises'
import { resolveDataDir } from '../paths.js'

const configuredDataDir = process.env.PLOTLINE_DATA_DIR ?? 'data-test'
const dataDir = resolveDataDir(configuredDataDir)

await rm(dataDir, { recursive: true, force: true })
await mkdir(dataDir, { recursive: true })
