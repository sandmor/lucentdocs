import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  CONFIG_FILE_NAME,
  DEFAULT_DATA_DIR,
  SQLITE_FILE_NAME,
  resolveDataDir,
  resolveDataFile,
} from '../paths.js'

const DEFAULT_PORT = 5677
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_NODE_ENV = 'development'
const DEFAULT_YJS_PERSISTENCE_FLUSH_MS = 2000
const DEFAULT_YJS_VERSION_INTERVAL_MS = 300000
const DEFAULT_AI_MODEL = 'gpt-4o-mini'
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-haiku-latest'
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1'

export interface PersistedAppConfig {
  NODE_ENV: string
  HOST: string
  PORT: number
  AI_API_KEY: string
  AI_BASE_URL: string
  AI_MODEL: string
  YJS_PERSISTENCE_FLUSH_MS: number
  YJS_VERSION_INTERVAL_MS: number
}

type PersistedConfigKey = keyof PersistedAppConfig

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

const DEFAULT_PERSISTED_CONFIG: PersistedAppConfig = {
  NODE_ENV: DEFAULT_NODE_ENV,
  HOST: DEFAULT_HOST,
  PORT: DEFAULT_PORT,
  AI_API_KEY: '',
  AI_BASE_URL: '',
  AI_MODEL: '',
  YJS_PERSISTENCE_FLUSH_MS: DEFAULT_YJS_PERSISTENCE_FLUSH_MS,
  YJS_VERSION_INTERVAL_MS: DEFAULT_YJS_VERSION_INTERVAL_MS,
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

function normalizeHost(value: string | undefined): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : DEFAULT_HOST
}

function normalizeNodeEnv(value: string | undefined): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : DEFAULT_NODE_ENV
}

function normalizePort(value: number | undefined): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65_535) {
    return value
  }
  return DEFAULT_PORT
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  return fallback
}

function normalizeAiValue(value: string | undefined): string {
  return value?.trim() ?? ''
}

function parseTomlString(raw: string): string | undefined {
  if (raw.length < 2) return undefined
  const quote = raw[0]
  if ((quote !== '"' && quote !== "'") || raw[raw.length - 1] !== quote) return undefined

  const body = raw.slice(1, -1)
  if (quote === "'") return body

  let result = ''
  for (let i = 0; i < body.length; i += 1) {
    const current = body[i]
    if (current !== '\\') {
      result += current
      continue
    }

    const next = body[i + 1]
    if (!next) {
      result += '\\'
      continue
    }

    i += 1
    switch (next) {
      case 'n':
        result += '\n'
        break
      case 'r':
        result += '\r'
        break
      case 't':
        result += '\t'
        break
      case '"':
        result += '"'
        break
      case '\\':
        result += '\\'
        break
      default:
        result += next
        break
    }
  }

  return result
}

function stripInlineComment(raw: string): string {
  let inSingleQuoted = false
  let inDoubleQuoted = false
  let escaped = false

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]
    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\' && (inSingleQuoted || inDoubleQuoted)) {
      escaped = true
      continue
    }

    if (char === "'" && !inDoubleQuoted) {
      inSingleQuoted = !inSingleQuoted
      continue
    }

    if (char === '"' && !inSingleQuoted) {
      inDoubleQuoted = !inDoubleQuoted
      continue
    }

    if (char === '#' && !inSingleQuoted && !inDoubleQuoted) {
      return raw.slice(0, i)
    }
  }

  return raw
}

function parseTomlValue(raw: string): string | number | undefined {
  const trimmed = stripInlineComment(raw).trim()
  if (!trimmed) return undefined

  const parsedString = parseTomlString(trimmed)
  if (parsedString !== undefined) return parsedString

  if (/^[+-]?\d+$/.test(trimmed)) {
    const parsedInt = Number.parseInt(trimmed, 10)
    if (Number.isInteger(parsedInt)) return parsedInt
  }

  return undefined
}

function assignParsedValue(
  parsed: Partial<PersistedAppConfig>,
  configKey: PersistedConfigKey,
  value: string | number
): void {
  switch (configKey) {
    case 'NODE_ENV':
      if (typeof value === 'string' && value.trim()) parsed.NODE_ENV = value.trim()
      break
    case 'HOST':
      if (typeof value === 'string' && value.trim()) parsed.HOST = value.trim()
      break
    case 'PORT':
      if (typeof value === 'number') parsed.PORT = value
      break
    case 'AI_API_KEY':
      if (typeof value === 'string') parsed.AI_API_KEY = value.trim()
      break
    case 'AI_BASE_URL':
      if (typeof value === 'string') parsed.AI_BASE_URL = value.trim()
      break
    case 'AI_MODEL':
      if (typeof value === 'string') parsed.AI_MODEL = value.trim()
      break
    case 'YJS_PERSISTENCE_FLUSH_MS':
      if (typeof value === 'number') parsed.YJS_PERSISTENCE_FLUSH_MS = value
      break
    case 'YJS_VERSION_INTERVAL_MS':
      if (typeof value === 'number') parsed.YJS_VERSION_INTERVAL_MS = value
      break
    default:
      break
  }
}

function parseFileConfig(contents: string): Partial<PersistedAppConfig> {
  const parsed: Partial<PersistedAppConfig> = {}
  let section = ''

  for (const line of contents.split(/\r?\n/)) {
    const trimmedLine = line.trim()
    if (!trimmedLine || trimmedLine.startsWith('#')) continue

    if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
      section = trimmedLine.slice(1, -1).trim().toLowerCase()
      continue
    }

    const equalsIndex = trimmedLine.indexOf('=')
    if (equalsIndex <= 0) continue

    const key = trimmedLine.slice(0, equalsIndex).trim()
    const value = parseTomlValue(trimmedLine.slice(equalsIndex + 1))
    if (value === undefined) continue

    const normalizedKey = key.toLowerCase()
    if (section === 'app') {
      if (normalizedKey === 'environment') {
        assignParsedValue(parsed, 'NODE_ENV', value)
      }
      continue
    }

    if (section === 'server') {
      if (normalizedKey === 'host') assignParsedValue(parsed, 'HOST', value)
      if (normalizedKey === 'port') assignParsedValue(parsed, 'PORT', value)
      continue
    }

    if (section === 'ai') {
      if (normalizedKey === 'api_key') assignParsedValue(parsed, 'AI_API_KEY', value)
      if (normalizedKey === 'base_url') assignParsedValue(parsed, 'AI_BASE_URL', value)
      if (normalizedKey === 'model') assignParsedValue(parsed, 'AI_MODEL', value)
      continue
    }

    if (section === 'yjs') {
      if (normalizedKey === 'persistence_flush_interval_ms') {
        assignParsedValue(parsed, 'YJS_PERSISTENCE_FLUSH_MS', value)
      }
      if (normalizedKey === 'version_snapshot_interval_ms') {
        assignParsedValue(parsed, 'YJS_VERSION_INTERVAL_MS', value)
      }
      continue
    }
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

  const nodeEnv = readEnvString(env, 'NODE_ENV')
  if (nodeEnv !== undefined) envConfig.NODE_ENV = nodeEnv

  const host = readEnvString(env, 'HOST')
  if (host !== undefined) envConfig.HOST = host

  const port = readEnvInt(env, 'PORT')
  if (port !== undefined) envConfig.PORT = port

  const apiKey = readEnvString(env, 'AI_API_KEY', { allowEmpty: true })
  if (apiKey !== undefined) envConfig.AI_API_KEY = apiKey

  const baseURL = readEnvString(env, 'AI_BASE_URL', { allowEmpty: true })
  if (baseURL !== undefined) envConfig.AI_BASE_URL = baseURL

  const model = readEnvString(env, 'AI_MODEL', { allowEmpty: true })
  if (model !== undefined) envConfig.AI_MODEL = model

  const persistenceFlushMs = readEnvInt(env, 'YJS_PERSISTENCE_FLUSH_MS')
  if (persistenceFlushMs !== undefined) envConfig.YJS_PERSISTENCE_FLUSH_MS = persistenceFlushMs

  const versionIntervalMs = readEnvInt(env, 'YJS_VERSION_INTERVAL_MS')
  if (versionIntervalMs !== undefined) envConfig.YJS_VERSION_INTERVAL_MS = versionIntervalMs

  return envConfig
}

function mergeConfig(
  fileConfig: Partial<PersistedAppConfig>,
  envConfig: Partial<PersistedAppConfig>
): PersistedAppConfig {
  const merged: PersistedAppConfig = {
    ...DEFAULT_PERSISTED_CONFIG,
    ...fileConfig,
    ...envConfig,
  }

  return {
    NODE_ENV: normalizeNodeEnv(merged.NODE_ENV),
    HOST: normalizeHost(merged.HOST),
    PORT: normalizePort(merged.PORT),
    AI_API_KEY: normalizeAiValue(merged.AI_API_KEY),
    AI_BASE_URL: normalizeAiValue(merged.AI_BASE_URL),
    AI_MODEL: normalizeAiValue(merged.AI_MODEL),
    YJS_PERSISTENCE_FLUSH_MS: normalizePositiveInt(
      merged.YJS_PERSISTENCE_FLUSH_MS,
      DEFAULT_YJS_PERSISTENCE_FLUSH_MS
    ),
    YJS_VERSION_INTERVAL_MS: normalizePositiveInt(
      merged.YJS_VERSION_INTERVAL_MS,
      DEFAULT_YJS_VERSION_INTERVAL_MS
    ),
  }
}

function escapeTomlString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`
}

function serializeConfig(config: PersistedAppConfig): string {
  return [
    '# Plotline application configuration.',
    '[app]',
    `environment = ${escapeTomlString(config.NODE_ENV)}`,
    '',
    '[server]',
    `host = ${escapeTomlString(config.HOST)}`,
    `port = ${config.PORT}`,
    '',
    '[ai]',
    `api_key = ${escapeTomlString(config.AI_API_KEY)}`,
    `base_url = ${escapeTomlString(config.AI_BASE_URL)}`,
    `model = ${escapeTomlString(config.AI_MODEL)}`,
    '',
    '[yjs]',
    `persistence_flush_interval_ms = ${config.YJS_PERSISTENCE_FLUSH_MS}`,
    `version_snapshot_interval_ms = ${config.YJS_VERSION_INTERVAL_MS}`,
    '',
  ].join('\n')
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

export class ConfigManager {
  private resolvedConfig: AppConfig | null = null

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  getConfig(): AppConfig {
    if (this.resolvedConfig) return this.resolvedConfig

    const configuredDataDir = normalizeDataDir(readEnvString(this.env, 'PLOTLINE_DATA_DIR'))
    const configFilePath = resolveDataFile(configuredDataDir, CONFIG_FILE_NAME)
    const envConfig = readConfigFromEnv(this.env)
    const fileConfig = readConfigFromFile(configFilePath)
    const rawConfig = mergeConfig(fileConfig, envConfig)

    mkdirSync(resolveDataDir(configuredDataDir), { recursive: true })
    writeConfigAtomically(configFilePath, serializeConfig(rawConfig))

    const aiConfig = resolveAiConfig(rawConfig)
    const resolved = freezeResolvedConfig({
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

    this.resolvedConfig = resolved
    return resolved
  }

  resetForTests(): void {
    this.resolvedConfig = null
  }
}

export const configManager = new ConfigManager()
