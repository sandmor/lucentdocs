import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import TOML from '@iarna/toml'
import {
  CONFIG_FIELD_BY_KEY,
  CONFIG_FIELD_DEFINITIONS,
  DEFAULT_PERSISTED_CONFIG,
  EDITABLE_CONFIG_KEYS,
  PERSISTED_CONFIG_KEYS,
  type LimitsConfig,
  type PersistedAppConfig,
  type PersistedConfigKey,
  type PersistedConfigSection,
} from '@plotline/shared'
import {
  CONFIG_FILE_NAME,
  DEFAULT_DATA_DIR,
  SQLITE_FILE_NAME,
  resolveDataDir,
  resolveDataFile,
} from '../paths.js'

const DEFAULT_TEST_DATA_DIR = 'data-test'
const TEST_MODE_ENV_VAR = 'PLOTLINE_TEST_MODE'
const TEST_DATA_DIR_ENV_VAR = 'PLOTLINE_TEST_DATA_DIR'
const ALLOW_UNSAFE_TEST_DB_ENV_VAR = 'PLOTLINE_ALLOW_UNSAFE_TEST_DB'

export type ConfigValueSource = 'env' | 'file' | 'default'

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
    configFile: string
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
  fileConfig: Partial<PersistedAppConfig>
  sources: Record<PersistedConfigKey, ConfigValueSource>
}

export interface UpdateConfigResult {
  state: ConfigStateSnapshot
  changedFileKeys: PersistedConfigKey[]
  changedEffectiveKeys: PersistedConfigKey[]
  overriddenChangedKeys: PersistedConfigKey[]
}

type PersistedConfigValue = PersistedAppConfig[PersistedConfigKey]

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

function normalizeDataDir(value: string | undefined): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : DEFAULT_DATA_DIR
}

function isTruthyEnvValue(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function isTestRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV?.trim() === 'test' || isTruthyEnvValue(env[TEST_MODE_ENV_VAR])
}

function isMainDataDir(dataDir: string): boolean {
  return path.resolve(resolveDataDir(dataDir)) === path.resolve(resolveDataDir(DEFAULT_DATA_DIR))
}

function resolveConfiguredDataDir(env: NodeJS.ProcessEnv): string {
  const configuredDataDir = normalizeDataDir(readEnvString(env, 'PLOTLINE_DATA_DIR'))
  const configuredTestDataDir = readEnvString(env, TEST_DATA_DIR_ENV_VAR)
  const desiredDataDir = normalizeDataDir(configuredTestDataDir ?? configuredDataDir)

  if (!isTestRuntime(env) || isTruthyEnvValue(env[ALLOW_UNSAFE_TEST_DB_ENV_VAR])) {
    return desiredDataDir
  }

  if (!isMainDataDir(desiredDataDir)) return desiredDataDir

  console.warn(
    `[plotline:test-safety] Blocking unsafe test database path "${desiredDataDir}". Using "${DEFAULT_TEST_DATA_DIR}" instead.`
  )
  return DEFAULT_TEST_DATA_DIR
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function parseFileConfig(contents: string): Partial<PersistedAppConfig> {
  const parsed: Partial<PersistedAppConfig> = {}
  const parsedRecord = parsed as Partial<Record<PersistedConfigKey, PersistedConfigValue>>
  const document = TOML.parse(contents)
  if (!isRecordValue(document)) return parsed

  for (const field of CONFIG_FIELD_DEFINITIONS) {
    const section = document[field.section]
    if (!isRecordValue(section)) continue

    const value = parseConfigValue(field.key, section[field.tomlKey])
    if (value !== undefined) parsedRecord[field.key] = value
  }

  return parsed
}

function readConfigFromFile(configPath: string): Partial<PersistedAppConfig> {
  if (!existsSync(configPath)) return {}

  try {
    const contents = readFileSync(configPath, 'utf8')
    return parseFileConfig(contents)
  } catch (error) {
    console.warn(
      `Failed to read config file at ${configPath}. Falling back to env/default values. ${error instanceof Error ? error.message : String(error)}`
    )
    return {}
  }
}

function readConfigFromEnv(env: NodeJS.ProcessEnv): Partial<PersistedAppConfig> {
  const envConfig: Partial<PersistedAppConfig> = {}
  const envRecord = envConfig as Partial<Record<PersistedConfigKey, PersistedConfigValue>>

  for (const field of CONFIG_FIELD_DEFINITIONS) {
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

function mergeConfig(
  fileConfig: Partial<PersistedAppConfig>,
  envConfig: Partial<PersistedAppConfig> = {}
): PersistedAppConfig {
  const merged: Partial<PersistedAppConfig> = {
    ...DEFAULT_PERSISTED_CONFIG,
    ...fileConfig,
    ...envConfig,
  }

  const normalizedRecord = {} as Record<PersistedConfigKey, PersistedConfigValue>

  for (const key of PERSISTED_CONFIG_KEYS) {
    normalizedRecord[key] = normalizeConfigValue(key, merged[key])
  }

  return normalizedRecord as unknown as PersistedAppConfig
}

function serializeConfig(config: PersistedAppConfig): string {
  const sections: Record<PersistedConfigSection, Record<string, string | number | boolean>> = {
    app: {},
    server: {},
    auth: {},
    ai: {},
    yjs: {},
    limits: {},
  }

  for (const field of CONFIG_FIELD_DEFINITIONS) {
    sections[field.section][field.tomlKey] = config[field.key]
  }

  const body = TOML.stringify(sections as never).trimEnd()
  return `# Plotline application configuration.\n${body}\n`
}

function writeConfigAtomically(configPath: string, contents: string): void {
  const existingContents = existsSync(configPath) ? readFileSync(configPath, 'utf8') : null
  if (existingContents === contents) return

  const directory = path.dirname(configPath)
  mkdirSync(directory, { recursive: true })

  const tempPath = path.join(
    directory,
    `.${path.basename(configPath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  )

  writeFileSync(tempPath, contents, 'utf8')
  try {
    renameSync(tempPath, configPath)
  } catch (error) {
    unlinkSync(tempPath)
    throw error
  }
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

function buildResolvedConfig(
  rawConfig: PersistedAppConfig,
  configuredDataDir: string,
  configFilePath: string
): AppConfig {
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
      dataDir: resolveDataDir(configuredDataDir),
      configFile: configFilePath,
      dbFile: resolveDataFile(configuredDataDir, SQLITE_FILE_NAME),
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
  fileConfig: Partial<PersistedAppConfig>,
  envConfig: Partial<PersistedAppConfig>
): Record<PersistedConfigKey, ConfigValueSource> {
  const sources = {} as Record<PersistedConfigKey, ConfigValueSource>

  for (const key of PERSISTED_CONFIG_KEYS) {
    if (envConfig[key] !== undefined) {
      sources[key] = 'env'
      continue
    }
    if (fileConfig[key] !== undefined) {
      sources[key] = 'file'
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

export class ConfigManager {
  private resolvedConfig: AppConfig | null = null

  private readonly env: NodeJS.ProcessEnv

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env
  }

  private loadState(): ConfigStateSnapshot {
    const configuredDataDir = resolveConfiguredDataDir(this.env)
    const configFilePath = resolveDataFile(configuredDataDir, CONFIG_FILE_NAME)

    mkdirSync(resolveDataDir(configuredDataDir), { recursive: true })
    if (!existsSync(configFilePath)) {
      writeConfigAtomically(configFilePath, serializeConfig(DEFAULT_PERSISTED_CONFIG))
    }

    const fileConfigPartial = readConfigFromFile(configFilePath)
    const envConfig = readConfigFromEnv(this.env)
    const rawConfig = mergeConfig(fileConfigPartial, envConfig)

    return {
      config: buildResolvedConfig(rawConfig, configuredDataDir, configFilePath),
      fileConfig: fileConfigPartial,
      sources: resolveConfigSources(fileConfigPartial, envConfig),
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

  updateFileConfig(patch: Partial<PersistedAppConfig>): UpdateConfigResult {
    const previousState = this.getState()
    const previousFileConfig = mergeConfig(previousState.fileConfig)
    const validatedPatch = sanitizeEditablePatch(patch)
    const nextFileConfig = mergeConfig({
      ...previousFileConfig,
      ...validatedPatch,
    })

    const changedFileKeys: PersistedConfigKey[] = PERSISTED_CONFIG_KEYS.filter(
      (key) => !configValuesEqual(previousFileConfig[key], nextFileConfig[key])
    )

    if (changedFileKeys.length > 0) {
      writeConfigAtomically(previousState.config.paths.configFile, serializeConfig(nextFileConfig))
    }

    this.resolvedConfig = null
    const nextState = this.getState()

    const changedEffectiveKeys: PersistedConfigKey[] = PERSISTED_CONFIG_KEYS.filter(
      (key) => !configValuesEqual(previousState.config.raw[key], nextState.config.raw[key])
    )
    const overriddenChangedKeys: PersistedConfigKey[] = changedFileKeys.filter(
      (key) => nextState.sources[key] === 'env'
    )

    return {
      state: nextState,
      changedFileKeys,
      changedEffectiveKeys,
      overriddenChangedKeys,
    }
  }

  resetForTests(): void {
    this.resolvedConfig = null
  }
}

export const configManager = new ConfigManager()
