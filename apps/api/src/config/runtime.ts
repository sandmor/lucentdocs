import { ConfigManager } from './manager.js'
import { createDefaultConfigStore } from './default-store.js'

export const configManager = new ConfigManager(process.env, {
  storeProvider: createDefaultConfigStore,
})
