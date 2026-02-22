import { z } from 'zod/v4'

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

export type PersistedConfigKey = keyof PersistedAppConfig
export type PersistedConfigSection = 'app' | 'server' | 'ai' | 'yjs'
export type ConfigValueKind = 'string' | 'int'

export interface ConfigFieldDefinition {
  key: PersistedConfigKey
  section: PersistedConfigSection
  tomlKey: string
  envVar: string
  kind: ConfigValueKind
  defaultValue: string | number
  allowEmptyString: boolean
  min?: number
  max?: number
}

export const CONFIG_FIELD_DEFINITIONS: readonly ConfigFieldDefinition[] = [
  {
    key: 'NODE_ENV',
    section: 'app',
    tomlKey: 'environment',
    envVar: 'NODE_ENV',
    kind: 'string',
    defaultValue: 'development',
    allowEmptyString: false,
  },
  {
    key: 'HOST',
    section: 'server',
    tomlKey: 'host',
    envVar: 'HOST',
    kind: 'string',
    defaultValue: '127.0.0.1',
    allowEmptyString: false,
  },
  {
    key: 'PORT',
    section: 'server',
    tomlKey: 'port',
    envVar: 'PORT',
    kind: 'int',
    defaultValue: 5677,
    allowEmptyString: false,
    min: 1,
    max: 65535,
  },
  {
    key: 'AI_API_KEY',
    section: 'ai',
    tomlKey: 'api_key',
    envVar: 'AI_API_KEY',
    kind: 'string',
    defaultValue: '',
    allowEmptyString: true,
  },
  {
    key: 'AI_BASE_URL',
    section: 'ai',
    tomlKey: 'base_url',
    envVar: 'AI_BASE_URL',
    kind: 'string',
    defaultValue: '',
    allowEmptyString: true,
  },
  {
    key: 'AI_MODEL',
    section: 'ai',
    tomlKey: 'model',
    envVar: 'AI_MODEL',
    kind: 'string',
    defaultValue: '',
    allowEmptyString: true,
  },
  {
    key: 'YJS_PERSISTENCE_FLUSH_MS',
    section: 'yjs',
    tomlKey: 'persistence_flush_interval_ms',
    envVar: 'YJS_PERSISTENCE_FLUSH_MS',
    kind: 'int',
    defaultValue: 2000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'YJS_VERSION_INTERVAL_MS',
    section: 'yjs',
    tomlKey: 'version_snapshot_interval_ms',
    envVar: 'YJS_VERSION_INTERVAL_MS',
    kind: 'int',
    defaultValue: 300000,
    allowEmptyString: false,
    min: 1,
  },
] as const

export const PERSISTED_CONFIG_KEYS = CONFIG_FIELD_DEFINITIONS.map((field) => field.key) as PersistedConfigKey[]

export const CONFIG_FIELD_BY_KEY: Readonly<Record<PersistedConfigKey, ConfigFieldDefinition>> =
  Object.freeze(
    Object.fromEntries(CONFIG_FIELD_DEFINITIONS.map((field) => [field.key, field])) as Record<
      PersistedConfigKey,
      ConfigFieldDefinition
    >
  )

export const DEFAULT_PERSISTED_CONFIG = Object.freeze(
  Object.fromEntries(
    CONFIG_FIELD_DEFINITIONS.map((field) => [field.key, field.defaultValue])
  ) as unknown as PersistedAppConfig
)

export const EDITABLE_CONFIG_KEYS = [
  'AI_API_KEY',
  'AI_BASE_URL',
  'AI_MODEL',
  'YJS_PERSISTENCE_FLUSH_MS',
  'YJS_VERSION_INTERVAL_MS',
] as const satisfies ReadonlyArray<PersistedConfigKey>

const yjsPersistenceFlushField = CONFIG_FIELD_BY_KEY.YJS_PERSISTENCE_FLUSH_MS
const yjsVersionIntervalField = CONFIG_FIELD_BY_KEY.YJS_VERSION_INTERVAL_MS

export const editableConfigSchema = z.object({
  AI_API_KEY: z.string().max(4096),
  AI_BASE_URL: z
    .string()
    .max(2048)
    .refine(
      (value) => {
        const trimmed = value.trim()
        if (!trimmed) return true
        try {
          const parsed = new URL(trimmed)
          return parsed.protocol === 'http:' || parsed.protocol === 'https:'
        } catch {
          return false
        }
      },
      {
        message: 'Must be a valid http(s) URL or empty to use provider defaults.',
      }
    ),
  AI_MODEL: z.string().max(200),
  YJS_PERSISTENCE_FLUSH_MS: z
    .number()
    .int()
    .min(Math.max(yjsPersistenceFlushField.min ?? 1, 100))
    .max(600000),
  YJS_VERSION_INTERVAL_MS: z
    .number()
    .int()
    .min(Math.max(yjsVersionIntervalField.min ?? 1, 1000))
    .max(86400000),
})

export type EditableConfigInput = z.infer<typeof editableConfigSchema>
