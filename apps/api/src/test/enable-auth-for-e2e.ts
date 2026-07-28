import { openRustStorageSync } from '../infrastructure/rust/engine.js'
import { RustAppConfigRepository } from '../infrastructure/rust/appConfig.adapter.js'
import { resolveDataFile } from '../paths.js'

const dataDir = process.env.LUCENTDOCS_TEST_DATA_DIR?.trim() || 'data-test'
const engine = openRustStorageSync(resolveDataFile(dataDir, 'sqlite.db'))
try {
  new RustAppConfigRepository(engine).upsertMany({ authEnabled: true }, Date.now())
} finally {
  await engine.close()
}
