import { configManager } from './manager.js'

export const YJS_CONFIG = {
  get persistenceFlushIntervalMs(): number {
    return configManager.getConfig().yjs.persistenceFlushIntervalMs
  },

  get versionSnapshotIntervalMs(): number {
    return configManager.getConfig().yjs.versionSnapshotIntervalMs
  },
}
