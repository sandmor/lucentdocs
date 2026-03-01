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
import { router, publicProcedure } from '../index.js'

type EditableConfigKey = (typeof EDITABLE_CONFIG_KEYS)[number]

const AI_RUNTIME_KEYS = ['aiApiKey', 'aiBaseUrl', 'aiModel'] as const
const YJS_RUNTIME_KEYS = ['yjsPersistenceFlushMs', 'yjsVersionIntervalMs'] as const

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

  const host = String(fields.host.effectiveValue)

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

  update: publicProcedure.input(editableConfigSchema).mutation(({ ctx, input }) => {
    const sanitizedInput: Pick<PersistedAppConfig, EditableConfigKey> = {
      aiApiKey: input.aiApiKey.trim(),
      aiBaseUrl: input.aiBaseUrl.trim(),
      aiModel: input.aiModel.trim(),
      yjsPersistenceFlushMs: input.yjsPersistenceFlushMs,
      yjsVersionIntervalMs: input.yjsVersionIntervalMs,
      maxContextChars: input.maxContextChars,
      maxHintChars: input.maxHintChars,
      maxPromptChars: input.maxPromptChars,
      maxToolEntries: input.maxToolEntries,
      maxToolReadChars: input.maxToolReadChars,
      maxAiToolSteps: input.maxAiToolSteps,
      maxChatMessageChars: input.maxChatMessageChars,
      maxPromptNameChars: input.maxPromptNameChars,
      maxPromptDescChars: input.maxPromptDescChars,
      maxPromptSystemChars: input.maxPromptSystemChars,
      maxPromptUserChars: input.maxPromptUserChars,
      maxDocImportChars: input.maxDocImportChars,
      maxDocExportChars: input.maxDocExportChars,
    }

    const result = configManager.updateFileConfig(sanitizedInput)
    const changedEffectiveSet = new Set(result.changedEffectiveKeys)

    if (AI_RUNTIME_KEYS.some((key) => changedEffectiveSet.has(key))) {
      resetClient()
    }

    if (YJS_RUNTIME_KEYS.some((key) => changedEffectiveSet.has(key))) {
      const config = configManager.getConfig()
      ctx.yjsRuntime.reloadRuntimeConfig({
        persistenceFlushIntervalMs: config.yjs.persistenceFlushIntervalMs,
        versionSnapshotIntervalMs: config.yjs.versionSnapshotIntervalMs,
      })
    }

    return {
      ...buildConfigPayload(result.state),
      changedFileKeys: result.changedFileKeys,
      changedEffectiveKeys: result.changedEffectiveKeys,
      overriddenChangedKeys: result.overriddenChangedKeys,
    }
  }),

  limits: publicProcedure.query(() => {
    return configManager.getConfig().limits
  }),
})
