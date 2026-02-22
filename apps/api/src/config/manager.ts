import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import TOML from '@iarna/toml'
import {
  CONFIG_FIELD_BY_KEY,
  CONFIG_FIELD_DEFINITIONS,
  DEFAULT_PERSISTED_CONFIG,
  EDITABLE_CONFIG_KEYS,
  PERSISTED_CONFIG_KEYS,
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

const DEFAULT_AI_MODEL = 'gpt-5'
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-haiku-latest'
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1'

export type ConfigValueSource = 'env' | 'file' | 'default'

export type AiProvider = 'openai' | 'anthropic' | 'openai-compatible'

export interface ResolvedAiConfig {
  provider: AiProvider
  baseURL: string
  apiKey: string
  model: string
}

export interface AppConfig {
  raw: PersistedAppConfig
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

function normalizeDataDir(value: string | undefined): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : DEFAULT_DATA_DIR
}

function normalizeConfigValue(
  key: PersistedConfigKey,
  value: unknown
): PersistedAppConfig[PersistedConfigKey] {
  const field = CONFIG_FIELD_BY_KEY[key]

  if (field.kind === 'string') {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (!trimmed && !field.allowEmptyString) {
      return String(field.defaultValue)
    }
    return trimmed
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
): PersistedAppConfig[PersistedConfigKey] | undefined {
  const field = CONFIG_FIELD_BY_KEY[key]

  if (field.kind === 'string') {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    if (!trimmed && !field.allowEmptyString) return undefined
    return trimmed
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  if (field.min !== undefined && value < field.min) return undefined
  if (field.max !== undefined && value > field.max) return undefined
  return value
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseFileConfig(contents: string): Partial<PersistedAppConfig> {
  const parsed: Partial<PersistedAppConfig> = {}
  const parsedRecord = parsed as Record<PersistedConfigKey, string | number>
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
  const envRecord = envConfig as Record<PersistedConfigKey, string | number>

  for (const field of CONFIG_FIELD_DEFINITIONS) {
    if (field.kind === 'string') {
      const raw = readEnvString(env, field.envVar, { allowEmpty: field.allowEmptyString })
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

  const normalizedRecord = {} as Record<PersistedConfigKey, string | number>

  for (const key of PERSISTED_CONFIG_KEYS) {
    normalizedRecord[key] = normalizeConfigValue(key, merged[key])
  }

  return normalizedRecord as unknown as PersistedAppConfig
}

function serializeConfig(config: PersistedAppConfig): string {
  const sections: Record<PersistedConfigSection, Record<string, string | number>> = {
    app: {},
    server: {},
    ai: {},
    yjs: {},
  }

  for (const field of CONFIG_FIELD_DEFINITIONS) {
    sections[field.section][field.tomlKey] = config[field.key]
  }

  const body = TOML.stringify(sections).trimEnd()
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

function guessProviderFromDomain(baseURL: string, model: string): AiProvider {
  let hostname = ''
  if (baseURL) {
    try {
      hostname = new URL(baseURL).hostname.toLowerCase()
    } catch {
      hostname = ''
    }
  }

  if (hostname.includes('anthropic')) return 'anthropic'
  if (hostname.includes('openai')) return 'openai'
  if (model.toLowerCase().startsWith('claude')) return 'anthropic'
  if (!baseURL) return 'openai'

  return 'openai-compatible'
}

function resolveAiConfig(config: PersistedAppConfig): ResolvedAiConfig {
  const defaultModel = config.AI_MODEL || DEFAULT_AI_MODEL
  const provider = guessProviderFromDomain(config.AI_BASE_URL, defaultModel)

  if (provider === 'anthropic') {
    return {
      provider,
      apiKey: config.AI_API_KEY,
      baseURL: config.AI_BASE_URL || DEFAULT_ANTHROPIC_BASE_URL,
      model: config.AI_MODEL || DEFAULT_ANTHROPIC_MODEL,
    }
  }

  return {
    provider,
    apiKey: config.AI_API_KEY,
    baseURL: config.AI_BASE_URL || DEFAULT_OPENAI_BASE_URL,
    model: defaultModel,
  }
}

function freezeResolvedConfig(config: AppConfig): AppConfig {
  Object.freeze(config.raw)
  Object.freeze(config.runtime)
  Object.freeze(config.server)
  Object.freeze(config.paths)
  Object.freeze(config.ai)
  Object.freeze(config.yjs)
  return Object.freeze(config)
}

function buildResolvedConfig(
  rawConfig: PersistedAppConfig,
  configuredDataDir: string,
  configFilePath: string
): AppConfig {
  const aiConfig = resolveAiConfig(rawConfig)
  return freezeResolvedConfig({
    raw: { ...rawConfig },
    runtime: {
      nodeEnv: rawConfig.NODE_ENV,
      isProduction: rawConfig.NODE_ENV === 'production',
    },
    server: {
      host: rawConfig.HOST,
      port: rawConfig.PORT,
    },
    paths: {
      dataDir: resolveDataDir(configuredDataDir),
      configFile: configFilePath,
      dbFile: resolveDataFile(configuredDataDir, SQLITE_FILE_NAME),
    },
    ai: { ...aiConfig },
    yjs: {
      persistenceFlushIntervalMs: rawConfig.YJS_PERSISTENCE_FLUSH_MS,
      versionSnapshotIntervalMs: rawConfig.YJS_VERSION_INTERVAL_MS,
    },
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

const editableConfigKeySet = new Set<PersistedConfigKey>(EDITABLE_CONFIG_KEYS)

function sanitizeEditablePatch(patch: Partial<PersistedAppConfig>): Partial<PersistedAppConfig> {
  const sanitized: Partial<PersistedAppConfig> = {}
  const sanitizedRecord = sanitized as Record<
    PersistedConfigKey,
    PersistedAppConfig[PersistedConfigKey] | undefined
  >

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
    const configuredDataDir = normalizeDataDir(readEnvString(this.env, 'PLOTLINE_DATA_DIR'))
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
      (key) => previousFileConfig[key] !== nextFileConfig[key]
    )

    if (changedFileKeys.length > 0) {
      writeConfigAtomically(previousState.config.paths.configFile, serializeConfig(nextFileConfig))
    }

    this.resolvedConfig = null
    const nextState = this.getState()

    const changedEffectiveKeys: PersistedConfigKey[] = PERSISTED_CONFIG_KEYS.filter(
      (key) => previousState.config.raw[key] !== nextState.config.raw[key]
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
