export const YJS_CONFIG = {
  get persistenceFlushIntervalMs(): number {
    const env = process.env.YJS_PERSISTENCE_FLUSH_MS
    if (env) {
      const parsed = parseInt(env, 10)
      if (!isNaN(parsed) && parsed > 0) {
        return parsed
      }
    }
    return 2000
  },

  get versionSnapshotIntervalMs(): number {
    const env = process.env.YJS_VERSION_INTERVAL_MS
    if (env) {
      const parsed = parseInt(env, 10)
      if (!isNaN(parsed) && parsed > 0) {
        return parsed
      }
    }
    return 300000
  },
}
