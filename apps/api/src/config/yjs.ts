import { configManager } from './runtime.js'

export const YJS_CONFIG = {
  get persistenceFlushIntervalMs(): number {
    return configManager.getConfig().yjs.persistenceFlushIntervalMs
  },

  get versionSnapshotIntervalMs(): number {
    return configManager.getConfig().yjs.versionSnapshotIntervalMs
  },
}
