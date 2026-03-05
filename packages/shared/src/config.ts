import { z } from 'zod/v4'
import { INLINE_AI_DEFAULT_TOOL_STEP_LIMIT } from './inline-ai.js'

export const AI_MODEL_SOURCE_TYPES = ['openai', 'anthropic'] as const

export type AiModelSourceType = (typeof AI_MODEL_SOURCE_TYPES)[number]

export interface PersistedAppConfig {
  nodeEnv: string
  host: string
  port: number
  aiDefaultTemperature: number
  aiSelectionEditTemperature: number
  aiDefaultMaxOutputTokens: number
  yjsPersistenceFlushMs: number
  yjsVersionIntervalMs: number
  maxContextChars: number
  maxPromptChars: number
  maxToolEntries: number
  maxToolReadChars: number
  maxAiToolSteps: number
  maxChatMessageChars: number
  maxPromptNameChars: number
  maxPromptDescChars: number
  maxPromptSystemChars: number
  maxPromptUserChars: number
  maxDocImportChars: number
  maxDocExportChars: number
}

export type PersistedConfigKey = keyof PersistedAppConfig
export type PersistedConfigSection = 'app' | 'server' | 'ai' | 'yjs' | 'limits'
export type ConfigValueKind = 'string' | 'int' | 'float'

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
    key: 'nodeEnv',
    section: 'app',
    tomlKey: 'environment',
    envVar: 'NODE_ENV',
    kind: 'string',
    defaultValue: 'development',
    allowEmptyString: false,
  },
  {
    key: 'host',
    section: 'server',
    tomlKey: 'host',
    envVar: 'HOST',
    kind: 'string',
    defaultValue: '127.0.0.1',
    allowEmptyString: false,
  },
  {
    key: 'port',
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
    key: 'aiDefaultTemperature',
    section: 'ai',
    tomlKey: 'default_temperature',
    envVar: 'AI_DEFAULT_TEMPERATURE',
    kind: 'float',
    defaultValue: 1.0,
    allowEmptyString: false,
    min: 0,
    max: 2,
  },
  {
    key: 'aiSelectionEditTemperature',
    section: 'ai',
    tomlKey: 'selection_edit_temperature',
    envVar: 'AI_SELECTION_EDIT_TEMPERATURE',
    kind: 'float',
    defaultValue: 1.0,
    allowEmptyString: false,
    min: 0,
    max: 2,
  },
  {
    key: 'aiDefaultMaxOutputTokens',
    section: 'ai',
    tomlKey: 'default_max_output_tokens',
    envVar: 'AI_DEFAULT_MAX_OUTPUT_TOKENS',
    kind: 'int',
    defaultValue: 4096,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'yjsPersistenceFlushMs',
    section: 'yjs',
    tomlKey: 'persistence_flush_interval_ms',
    envVar: 'YJS_PERSISTENCE_FLUSH_MS',
    kind: 'int',
    defaultValue: 2000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'yjsVersionIntervalMs',
    section: 'yjs',
    tomlKey: 'version_snapshot_interval_ms',
    envVar: 'YJS_VERSION_INTERVAL_MS',
    kind: 'int',
    defaultValue: 300000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxContextChars',
    section: 'limits',
    tomlKey: 'context_chars',
    envVar: 'LIMITS_CONTEXT_CHARS',
    kind: 'int',
    defaultValue: 1_000_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxPromptChars',
    section: 'limits',
    tomlKey: 'prompt_chars',
    envVar: 'LIMITS_PROMPT_CHARS',
    kind: 'int',
    defaultValue: 50_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxToolEntries',
    section: 'limits',
    tomlKey: 'tool_entries',
    envVar: 'LIMITS_TOOL_ENTRIES',
    kind: 'int',
    defaultValue: 2_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxToolReadChars',
    section: 'limits',
    tomlKey: 'tool_read_chars',
    envVar: 'LIMITS_TOOL_READ_CHARS',
    kind: 'int',
    defaultValue: 120_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxAiToolSteps',
    section: 'limits',
    tomlKey: 'ai_tool_steps',
    envVar: 'LIMITS_AI_TOOL_STEPS',
    kind: 'int',
    defaultValue: INLINE_AI_DEFAULT_TOOL_STEP_LIMIT,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxChatMessageChars',
    section: 'limits',
    tomlKey: 'chat_message_chars',
    envVar: 'LIMITS_CHAT_MESSAGE_CHARS',
    kind: 'int',
    defaultValue: 20_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxPromptNameChars',
    section: 'limits',
    tomlKey: 'prompt_name_chars',
    envVar: 'LIMITS_PROMPT_NAME_CHARS',
    kind: 'int',
    defaultValue: 160,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxPromptDescChars',
    section: 'limits',
    tomlKey: 'prompt_desc_chars',
    envVar: 'LIMITS_PROMPT_DESC_CHARS',
    kind: 'int',
    defaultValue: 2_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxPromptSystemChars',
    section: 'limits',
    tomlKey: 'prompt_system_chars',
    envVar: 'LIMITS_PROMPT_SYSTEM_CHARS',
    kind: 'int',
    defaultValue: 80_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxPromptUserChars',
    section: 'limits',
    tomlKey: 'prompt_user_chars',
    envVar: 'LIMITS_PROMPT_USER_CHARS',
    kind: 'int',
    defaultValue: 200_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxDocImportChars',
    section: 'limits',
    tomlKey: 'doc_import_chars',
    envVar: 'LIMITS_DOC_IMPORT_CHARS',
    kind: 'int',
    defaultValue: 500_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxDocExportChars',
    section: 'limits',
    tomlKey: 'doc_export_chars',
    envVar: 'LIMITS_DOC_EXPORT_CHARS',
    kind: 'int',
    defaultValue: 1_000_000,
    allowEmptyString: false,
    min: 1,
  },
] as const

export const PERSISTED_CONFIG_KEYS = CONFIG_FIELD_DEFINITIONS.map(
  (field) => field.key
) as PersistedConfigKey[]

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
  'aiDefaultTemperature',
  'aiSelectionEditTemperature',
  'aiDefaultMaxOutputTokens',
  'yjsPersistenceFlushMs',
  'yjsVersionIntervalMs',
  'maxContextChars',
  'maxPromptChars',
  'maxToolEntries',
  'maxToolReadChars',
  'maxAiToolSteps',
  'maxChatMessageChars',
  'maxPromptNameChars',
  'maxPromptDescChars',
  'maxPromptSystemChars',
  'maxPromptUserChars',
  'maxDocImportChars',
  'maxDocExportChars',
] as const satisfies ReadonlyArray<PersistedConfigKey>

export const LIMITS_CONFIG_KEYS = [
  'maxContextChars',
  'maxPromptChars',
  'maxToolEntries',
  'maxToolReadChars',
  'maxAiToolSteps',
  'maxChatMessageChars',
  'maxPromptNameChars',
  'maxPromptDescChars',
  'maxPromptSystemChars',
  'maxPromptUserChars',
  'maxDocImportChars',
  'maxDocExportChars',
] as const satisfies ReadonlyArray<PersistedConfigKey>

export interface LimitsConfig {
  contextChars: number
  promptChars: number
  toolEntries: number
  toolReadChars: number
  aiToolSteps: number
  chatMessageChars: number
  promptNameChars: number
  promptDescChars: number
  promptSystemChars: number
  promptUserChars: number
  docImportChars: number
  docExportChars: number
}

const yjsPersistenceFlushField = CONFIG_FIELD_BY_KEY.yjsPersistenceFlushMs
const yjsVersionIntervalField = CONFIG_FIELD_BY_KEY.yjsVersionIntervalMs
const limitsContextCharsField = CONFIG_FIELD_BY_KEY.maxContextChars
const limitsPromptCharsField = CONFIG_FIELD_BY_KEY.maxPromptChars
const limitsToolEntriesField = CONFIG_FIELD_BY_KEY.maxToolEntries
const limitsToolReadCharsField = CONFIG_FIELD_BY_KEY.maxToolReadChars
const limitsAiToolStepsField = CONFIG_FIELD_BY_KEY.maxAiToolSteps
const limitsChatMessageCharsField = CONFIG_FIELD_BY_KEY.maxChatMessageChars
const limitsPromptNameCharsField = CONFIG_FIELD_BY_KEY.maxPromptNameChars
const limitsPromptDescCharsField = CONFIG_FIELD_BY_KEY.maxPromptDescChars
const limitsPromptSystemCharsField = CONFIG_FIELD_BY_KEY.maxPromptSystemChars
const limitsPromptUserCharsField = CONFIG_FIELD_BY_KEY.maxPromptUserChars
const limitsDocImportCharsField = CONFIG_FIELD_BY_KEY.maxDocImportChars
const limitsDocExportCharsField = CONFIG_FIELD_BY_KEY.maxDocExportChars

const aiDefaultTempField = CONFIG_FIELD_BY_KEY.aiDefaultTemperature
const aiSelEditTempField = CONFIG_FIELD_BY_KEY.aiSelectionEditTemperature
const aiDefaultMaxTokensField = CONFIG_FIELD_BY_KEY.aiDefaultMaxOutputTokens

export const editableConfigSchema = z.object({
  aiDefaultTemperature: z
    .number()
    .min(aiDefaultTempField.min ?? 0)
    .max(aiDefaultTempField.max ?? 2),
  aiSelectionEditTemperature: z
    .number()
    .min(aiSelEditTempField.min ?? 0)
    .max(aiSelEditTempField.max ?? 2),
  aiDefaultMaxOutputTokens: z
    .number()
    .int()
    .min(aiDefaultMaxTokensField.min ?? 1),
  yjsPersistenceFlushMs: z
    .number()
    .int()
    .min(yjsPersistenceFlushField.min ?? 1),
  yjsVersionIntervalMs: z
    .number()
    .int()
    .min(yjsVersionIntervalField.min ?? 1),
  maxContextChars: z
    .number()
    .int()
    .min(limitsContextCharsField.min ?? 1),
  maxPromptChars: z
    .number()
    .int()
    .min(limitsPromptCharsField.min ?? 1),
  maxToolEntries: z
    .number()
    .int()
    .min(limitsToolEntriesField.min ?? 1),
  maxToolReadChars: z
    .number()
    .int()
    .min(limitsToolReadCharsField.min ?? 1),
  maxAiToolSteps: z
    .number()
    .int()
    .min(limitsAiToolStepsField.min ?? 1),
  maxChatMessageChars: z
    .number()
    .int()
    .min(limitsChatMessageCharsField.min ?? 1),
  maxPromptNameChars: z
    .number()
    .int()
    .min(limitsPromptNameCharsField.min ?? 1),
  maxPromptDescChars: z
    .number()
    .int()
    .min(limitsPromptDescCharsField.min ?? 1),
  maxPromptSystemChars: z
    .number()
    .int()
    .min(limitsPromptSystemCharsField.min ?? 1),
  maxPromptUserChars: z
    .number()
    .int()
    .min(limitsPromptUserCharsField.min ?? 1),
  maxDocImportChars: z
    .number()
    .int()
    .min(limitsDocImportCharsField.min ?? 1),
  maxDocExportChars: z
    .number()
    .int()
    .min(limitsDocExportCharsField.min ?? 1),
})

export type EditableConfigInput = z.infer<typeof editableConfigSchema>
