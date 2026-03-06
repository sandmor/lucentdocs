import {
  CONFIG_FIELD_BY_KEY,
  DEFAULT_PERSISTED_CONFIG,
  EDITABLE_CONFIG_KEYS,
  PERSISTED_CONFIG_KEYS,
  type LimitsConfig,
  type PersistedAppConfig,
  type PersistedConfigKey,
} from '@lucentdocs/shared'
import type { AppConfigRepositoryPort } from '../core/ports/appConfig.port.js'

export type ConfigValueSource = 'env' | 'database' | 'default'

export interface ResolvedAiConfig {
  defaultTemperature: number
  selectionEditTemperature: number
  defaultMaxOutputTokens: number
}

export interface AppConfig {
  raw: PersistedAppConfig
  auth: {
    enabled: boolean
  }
  runtime: {
    nodeEnv: string
    isProduction: boolean
  }
  server: {
    host: string
    port: number
  }
  paths: {
    dataDir: string
    dbFile: string
  }
  ai: ResolvedAiConfig
  yjs: {
    persistenceFlushIntervalMs: number
    versionSnapshotIntervalMs: number
  }
  limits: LimitsConfig
}

export interface ConfigStateSnapshot {
  config: AppConfig
  persistedConfig: Partial<PersistedAppConfig>
  sources: Record<PersistedConfigKey, ConfigValueSource>
}

export interface UpdateConfigResult {
  state: ConfigStateSnapshot
  changedPersistedKeys: PersistedConfigKey[]
  changedEffectiveKeys: PersistedConfigKey[]
  overriddenChangedKeys: PersistedConfigKey[]
}

type PersistedConfigValue = PersistedAppConfig[PersistedConfigKey]

export interface ConfigStoreHandle {
  dataDirPath: string
  dbFilePath: string
  repository: AppConfigRepositoryPort
  dispose: () => void
}

export type ConfigStoreProvider = (env: NodeJS.ProcessEnv) => ConfigStoreHandle

interface ConfigManagerOptions {
  storeProvider: ConfigStoreProvider
}

function hasEnvValue(env: NodeJS.ProcessEnv, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(env, key)
}

function readEnvString(
  env: NodeJS.ProcessEnv,
  key: string,
  options: { allowEmpty?: boolean } = {}
): string | undefined {
  if (!hasEnvValue(env, key)) return undefined
  const value = env[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!options.allowEmpty && trimmed.length === 0) return undefined
  return trimmed
}

function readEnvInt(env: NodeJS.ProcessEnv, key: string): number | undefined {
  if (!hasEnvValue(env, key)) return undefined
  const value = env[key]
  if (typeof value !== 'string') return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? parsed : undefined
}

function readEnvFloat(env: NodeJS.ProcessEnv, key: string): number | undefined {
  if (!hasEnvValue(env, key)) return undefined
  const value = env[key]
  if (typeof value !== 'string') return undefined
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function isTruthyEnvValue(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function normalizeConfigValue(key: PersistedConfigKey, value: unknown): PersistedConfigValue {
  const field = CONFIG_FIELD_BY_KEY[key]

  if (field.kind === 'boolean') {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') return isTruthyEnvValue(value)
    return Boolean(field.defaultValue)
  }

  if (field.kind === 'string') {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (!trimmed && !field.allowEmptyString) {
      return String(field.defaultValue)
    }
    return trimmed
  }

  if (field.kind === 'float') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return Number(field.defaultValue)
    }
    if (field.min !== undefined && value < field.min) return Number(field.defaultValue)
    if (field.max !== undefined && value > field.max) return Number(field.defaultValue)
    return value
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return Number(field.defaultValue)
  }

  if (field.min !== undefined && value < field.min) {
    return Number(field.defaultValue)
  }

  if (field.max !== undefined && value > field.max) {
    return Number(field.defaultValue)
  }

  return value
}

function parseConfigValue(
  key: PersistedConfigKey,
  value: unknown
): PersistedConfigValue | undefined {
  const field = CONFIG_FIELD_BY_KEY[key]

  if (field.kind === 'boolean') {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') return isTruthyEnvValue(value)
    return undefined
  }

  if (field.kind === 'string') {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    if (!trimmed && !field.allowEmptyString) return undefined
    return trimmed
  }

  if (field.kind === 'float') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
    if (field.min !== undefined && value < field.min) return undefined
    if (field.max !== undefined && value > field.max) return undefined
    return value
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  if (field.min !== undefined && value < field.min) return undefined
  if (field.max !== undefined && value > field.max) return undefined
  return value
}

function readConfigFromEnv(env: NodeJS.ProcessEnv): Partial<PersistedAppConfig> {
  const envConfig: Partial<PersistedAppConfig> = {}
  const envRecord = envConfig as Partial<Record<PersistedConfigKey, PersistedConfigValue>>

  for (const field of Object.values(CONFIG_FIELD_BY_KEY)) {
    if (field.kind === 'string' || field.kind === 'boolean') {
      const raw = readEnvString(env, field.envVar, { allowEmpty: field.allowEmptyString })
      if (raw === undefined) continue
      const value = parseConfigValue(field.key, raw)
      if (value !== undefined) envRecord[field.key] = value
      continue
    }

    if (field.kind === 'float') {
      const raw = readEnvFloat(env, field.envVar)
      if (raw === undefined) continue
      const value = parseConfigValue(field.key, raw)
      if (value !== undefined) envRecord[field.key] = value
      continue
    }

    const raw = readEnvInt(env, field.envVar)
    if (raw === undefined) continue
    const value = parseConfigValue(field.key, raw)
    if (value !== undefined) envRecord[field.key] = value
  }

  return envConfig
}

function sanitizePersistedConfig(
  persistedConfig: Partial<PersistedAppConfig>
): Partial<PersistedAppConfig> {
  const sanitized: Partial<PersistedAppConfig> = {}
  const sanitizedRecord = sanitized as Partial<Record<PersistedConfigKey, PersistedConfigValue>>

  for (const key of PERSISTED_CONFIG_KEYS) {
    const rawValue = persistedConfig[key]
    if (rawValue === undefined) continue

    const parsedValue = parseConfigValue(key, rawValue)
    if (parsedValue === undefined) continue

    sanitizedRecord[key] = parsedValue
  }

  return sanitized
}

function mergeConfig(
  persistedConfig: Partial<PersistedAppConfig>,
  envConfig: Partial<PersistedAppConfig> = {}
): PersistedAppConfig {
  const merged: Partial<PersistedAppConfig> = {
    ...DEFAULT_PERSISTED_CONFIG,
    ...persistedConfig,
    ...envConfig,
  }

  const normalizedRecord = {} as Record<PersistedConfigKey, PersistedConfigValue>

  for (const key of PERSISTED_CONFIG_KEYS) {
    normalizedRecord[key] = normalizeConfigValue(key, merged[key])
  }

  return normalizedRecord as unknown as PersistedAppConfig
}

function freezeResolvedConfig(config: AppConfig): AppConfig {
  Object.freeze(config.raw)
  Object.freeze(config.auth)
  Object.freeze(config.runtime)
  Object.freeze(config.server)
  Object.freeze(config.paths)
  Object.freeze(config.ai)
  Object.freeze(config.yjs)
  Object.freeze(config.limits)
  return Object.freeze(config)
}

function buildLimitsConfig(rawConfig: PersistedAppConfig): LimitsConfig {
  return {
    contextChars: rawConfig.maxContextChars,
    promptChars: rawConfig.maxPromptChars,
    toolEntries: rawConfig.maxToolEntries,
    toolReadChars: rawConfig.maxToolReadChars,
    aiToolSteps: rawConfig.maxAiToolSteps,
    chatMessageChars: rawConfig.maxChatMessageChars,
    promptNameChars: rawConfig.maxPromptNameChars,
    promptDescChars: rawConfig.maxPromptDescChars,
    promptSystemChars: rawConfig.maxPromptSystemChars,
    promptUserChars: rawConfig.maxPromptUserChars,
    docImportChars: rawConfig.maxDocImportChars,
    docExportChars: rawConfig.maxDocExportChars,
  }
}

function buildResolvedConfig(rawConfig: PersistedAppConfig, store: ConfigStoreHandle): AppConfig {
  return freezeResolvedConfig({
    raw: { ...rawConfig },
    auth: {
      enabled: Boolean(rawConfig.authEnabled),
    },
    runtime: {
      nodeEnv: rawConfig.nodeEnv,
      isProduction: rawConfig.nodeEnv === 'production',
    },
    server: {
      host: rawConfig.host,
      port: rawConfig.port,
    },
    paths: {
      dataDir: store.dataDirPath,
      dbFile: store.dbFilePath,
    },
    ai: {
      defaultTemperature: rawConfig.aiDefaultTemperature,
      selectionEditTemperature: rawConfig.aiSelectionEditTemperature,
      defaultMaxOutputTokens: rawConfig.aiDefaultMaxOutputTokens,
    },
    yjs: {
      persistenceFlushIntervalMs: rawConfig.yjsPersistenceFlushMs,
      versionSnapshotIntervalMs: rawConfig.yjsVersionIntervalMs,
    },
    limits: buildLimitsConfig(rawConfig),
  })
}

function resolveConfigSources(
  persistedConfig: Partial<PersistedAppConfig>,
  envConfig: Partial<PersistedAppConfig>
): Record<PersistedConfigKey, ConfigValueSource> {
  const sources = {} as Record<PersistedConfigKey, ConfigValueSource>

  for (const key of PERSISTED_CONFIG_KEYS) {
    if (envConfig[key] !== undefined) {
      sources[key] = 'env'
      continue
    }
    if (persistedConfig[key] !== undefined) {
      sources[key] = 'database'
      continue
    }
    sources[key] = 'default'
  }

  return sources
}

function configValuesEqual(
  left: PersistedConfigValue | undefined,
  right: PersistedConfigValue
): boolean {
  return left === right
}

const editableConfigKeySet = new Set<PersistedConfigKey>(EDITABLE_CONFIG_KEYS)

function sanitizeEditablePatch(patch: Partial<PersistedAppConfig>): Partial<PersistedAppConfig> {
  const sanitized: Partial<PersistedAppConfig> = {}
  const sanitizedRecord = sanitized as Partial<Record<PersistedConfigKey, PersistedConfigValue>>

  for (const [rawKey, rawValue] of Object.entries(patch)) {
    if (rawValue === undefined) continue

    const key = rawKey as PersistedConfigKey
    if (!editableConfigKeySet.has(key)) {
      throw new Error(`Config key ${rawKey} is not editable.`)
    }

    const parsedValue = parseConfigValue(key, rawValue)
    if (parsedValue === undefined) {
      throw new Error(`Invalid value for config key ${rawKey}.`)
    }

    sanitizedRecord[key] = parsedValue
  }

  return sanitized
}

function buildChangedPersistedPatch(
  beforeConfig: PersistedAppConfig,
  afterConfig: PersistedAppConfig,
  changedKeys: PersistedConfigKey[]
): Partial<PersistedAppConfig> {
  const patch: Partial<PersistedAppConfig> = {}
  const patchRecord = patch as Partial<Record<PersistedConfigKey, PersistedConfigValue>>

  for (const key of changedKeys) {
    if (beforeConfig[key] === afterConfig[key]) continue
    patchRecord[key] = afterConfig[key]
  }

  return patch
}

export class ConfigManager {
  private resolvedConfig: AppConfig | null = null

  private readonly env: NodeJS.ProcessEnv

  private readonly storeProvider: ConfigStoreProvider

  private storeHandle: ConfigStoreHandle | null = null

  constructor(env: NodeJS.ProcessEnv, options: ConfigManagerOptions) {
    this.env = env
    this.storeProvider = options.storeProvider
  }

  private getStoreHandle(): ConfigStoreHandle {
    if (this.storeHandle) return this.storeHandle

    const nextStoreHandle = this.storeProvider(this.env)

    if (nextStoreHandle.repository.isEmpty()) {
      nextStoreHandle.repository.upsertMany(DEFAULT_PERSISTED_CONFIG, Date.now())
    }

    this.storeHandle = nextStoreHandle
    return nextStoreHandle
  }

  private loadState(): ConfigStateSnapshot {
    const storeHandle = this.getStoreHandle()
    const persistedConfig = sanitizePersistedConfig(storeHandle.repository.readAll())
    const envConfig = readConfigFromEnv(this.env)
    const rawConfig = mergeConfig(persistedConfig, envConfig)

    return {
      config: buildResolvedConfig(rawConfig, storeHandle),
      persistedConfig,
      sources: resolveConfigSources(persistedConfig, envConfig),
    }
  }

  getConfig(): AppConfig {
    if (this.resolvedConfig) return this.resolvedConfig

    const state = this.loadState()
    this.resolvedConfig = state.config
    return state.config
  }

  getState(): ConfigStateSnapshot {
    const state = this.loadState()
    this.resolvedConfig = state.config
    return state
  }

  updatePersistedConfig(patch: Partial<PersistedAppConfig>): UpdateConfigResult {
    const previousState = this.getState()
    const previousPersistedConfig = mergeConfig(previousState.persistedConfig)
    const validatedPatch = sanitizeEditablePatch(patch)
    const nextPersistedConfig = mergeConfig({
      ...previousPersistedConfig,
      ...validatedPatch,
    })

    const changedPersistedKeys: PersistedConfigKey[] = PERSISTED_CONFIG_KEYS.filter(
      (key) => !configValuesEqual(previousPersistedConfig[key], nextPersistedConfig[key])
    )

    if (changedPersistedKeys.length > 0) {
      const changedPersistedPatch = buildChangedPersistedPatch(
        previousPersistedConfig,
        nextPersistedConfig,
        changedPersistedKeys
      )
      this.getStoreHandle().repository.upsertMany(changedPersistedPatch, Date.now())
    }

    this.resolvedConfig = null
    const nextState = this.getState()

    const changedEffectiveKeys: PersistedConfigKey[] = PERSISTED_CONFIG_KEYS.filter(
      (key) => !configValuesEqual(previousState.config.raw[key], nextState.config.raw[key])
    )
    const overriddenChangedKeys: PersistedConfigKey[] = changedPersistedKeys.filter(
      (key) => nextState.sources[key] === 'env'
    )

    return {
      state: nextState,
      changedPersistedKeys,
      changedEffectiveKeys,
      overriddenChangedKeys,
    }
  }

  resetForTests(): void {
    this.resolvedConfig = null

    if (this.storeHandle) {
      this.storeHandle.dispose()
      this.storeHandle = null
    }
  }
}
