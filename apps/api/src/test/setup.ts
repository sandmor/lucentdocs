import { mkdirSync, rmSync } from 'node:fs'
import { resolveDataDir } from '../paths.js'

process.env.NODE_ENV ??= 'test'
process.env.HOST ??= '127.0.0.1'
process.env.PORT ??= '5678'
process.env.PLOTLINE_DATA_DIR ??= 'data-test'

const dataDir = resolveDataDir(process.env.PLOTLINE_DATA_DIR)
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
