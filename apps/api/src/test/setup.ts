import { mkdirSync, rmSync } from 'node:fs'
import { resolveDataDir } from '../paths.js'

const testDataDir = process.env.PLOTLINE_TEST_DATA_DIR?.trim() || 'data-test'
const testHost = process.env.PLOTLINE_TEST_HOST?.trim() || '127.0.0.1'
const testPort = process.env.PLOTLINE_TEST_PORT?.trim() || '5678'

process.env.PLOTLINE_TEST_MODE = '1'
process.env.NODE_ENV = 'test'
process.env.HOST = testHost
process.env.PORT = testPort
process.env.PLOTLINE_DATA_DIR = testDataDir

const dataDir = resolveDataDir(process.env.PLOTLINE_DATA_DIR)
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
