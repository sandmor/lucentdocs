import {
  EDITABLE_CONFIG_KEYS,
  PERSISTED_CONFIG_KEYS,
  editableConfigSchema,
  type PersistedAppConfig,
} from '@plotline/shared'
import {
  type ConfigStateSnapshot,
  type ConfigValueSource,
  configManager,
} from '../../config/manager.js'
import { resetClient } from '../../ai/provider.js'
import { reloadRuntimeConfig } from '../../yjs/server.js'
import { router, publicProcedure } from '../index.js'

type EditableConfigKey = (typeof EDITABLE_CONFIG_KEYS)[number]

const AI_RUNTIME_KEYS = ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL'] as const
const YJS_RUNTIME_KEYS = ['YJS_PERSISTENCE_FLUSH_MS', 'YJS_VERSION_INTERVAL_MS'] as const

interface ConfigFieldPayload {
  effectiveValue: string | number
  fileValue: string | number | null
  source: ConfigValueSource
  isOverridden: boolean
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === 'localhost' ||
    normalized === '[::1]'
  )
}

function buildConfigPayload(state: ConfigStateSnapshot) {
  const fields = {} as Record<(typeof PERSISTED_CONFIG_KEYS)[number], ConfigFieldPayload>

  for (const key of PERSISTED_CONFIG_KEYS) {
    fields[key] = {
      effectiveValue: state.config.raw[key],
      fileValue: state.fileConfig[key] ?? null,
      source: state.sources[key],
      isOverridden: state.sources[key] === 'env',
    }
  }

  const host = String(fields.HOST.effectiveValue)

  return {
    fields,
    runtime: {
      nodeEnv: state.config.runtime.nodeEnv,
      host: state.config.server.host,
      port: state.config.server.port,
      configFilePath: state.config.paths.configFile,
      dataDir: state.config.paths.dataDir,
      isLoopbackHost: isLoopbackHost(host),
    },
  }
}

export const configRouter = router({
  get: publicProcedure.query(() => {
    const state = configManager.getState()
    return buildConfigPayload(state)
  }),

  update: publicProcedure.input(editableConfigSchema).mutation(({ input }) => {
    const sanitizedInput: Pick<PersistedAppConfig, EditableConfigKey> = {
      AI_API_KEY: input.AI_API_KEY.trim(),
      AI_BASE_URL: input.AI_BASE_URL.trim(),
      AI_MODEL: input.AI_MODEL.trim(),
      YJS_PERSISTENCE_FLUSH_MS: input.YJS_PERSISTENCE_FLUSH_MS,
      YJS_VERSION_INTERVAL_MS: input.YJS_VERSION_INTERVAL_MS,
    }

    const result = configManager.updateFileConfig(sanitizedInput)
    const changedEffectiveSet = new Set(result.changedEffectiveKeys)

    if (AI_RUNTIME_KEYS.some((key) => changedEffectiveSet.has(key))) {
      resetClient()
    }

    if (YJS_RUNTIME_KEYS.some((key) => changedEffectiveSet.has(key))) {
      reloadRuntimeConfig()
    }

    return {
      ...buildConfigPayload(result.state),
      changedFileKeys: result.changedFileKeys,
      changedEffectiveKeys: result.changedEffectiveKeys,
      overriddenChangedKeys: result.overriddenChangedKeys,
    }
  }),
})
