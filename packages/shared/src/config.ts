import { z } from 'zod/v4'
import { INLINE_AI_DEFAULT_TOOL_STEP_LIMIT } from './inline-ai.js'
import { DEFAULT_PROMPT_EXCERPT_CHARS, MIN_PROMPT_EXCERPT_CHARS } from './prompt-excerpt.js'

export const AI_MODEL_SOURCE_TYPES = ['openai', 'anthropic', 'openrouter'] as const

export type AiModelSourceType = (typeof AI_MODEL_SOURCE_TYPES)[number]

export interface PersistedAppConfig {
  authEnabled: boolean
  nodeEnv: string
  host: string
  port: number
  aiDefaultTemperature: number
  aiSelectionEditTemperature: number
  aiDefaultMaxOutputTokens: number
  embeddingDebounceMs: number
  embeddingBatchMaxWaitMs: number
  yjsPersistenceFlushMs: number
  yjsVersionIntervalMs: number
  searchDefaultLimit: number
  searchMaxLimit: number
  searchMaxQueryChars: number
  searchSnippetDefaultLimit: number
  searchSnippetMaxLimit: number
  searchSnippetMaxLength: number
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
  maxPromptExcerptChars: number
}

export type PersistedConfigKey = keyof PersistedAppConfig
export type ConfigValueKind = 'string' | 'int' | 'float' | 'boolean'

export interface ConfigFieldDefinition {
  key: PersistedConfigKey
  envVar: string
  kind: ConfigValueKind
  defaultValue: string | number | boolean
  allowEmptyString: boolean
  min?: number
  max?: number
}

export const CONFIG_FIELD_DEFINITIONS: readonly ConfigFieldDefinition[] = [
  {
    key: 'authEnabled',
    envVar: 'AUTH_ENABLED',
    kind: 'boolean',
    defaultValue: false,
    allowEmptyString: false,
  },
  {
    key: 'nodeEnv',
    envVar: 'NODE_ENV',
    kind: 'string',
    defaultValue: 'development',
    allowEmptyString: false,
  },
  {
    key: 'host',
    envVar: 'HOST',
    kind: 'string',
    defaultValue: '127.0.0.1',
    allowEmptyString: false,
  },
  {
    key: 'port',
    envVar: 'PORT',
    kind: 'int',
    defaultValue: 5677,
    allowEmptyString: false,
    min: 1,
    max: 65535,
  },
  {
    key: 'aiDefaultTemperature',
    envVar: 'AI_DEFAULT_TEMPERATURE',
    kind: 'float',
    defaultValue: 1.0,
    allowEmptyString: false,
    min: 0,
    max: 2,
  },
  {
    key: 'aiSelectionEditTemperature',
    envVar: 'AI_SELECTION_EDIT_TEMPERATURE',
    kind: 'float',
    defaultValue: 1.0,
    allowEmptyString: false,
    min: 0,
    max: 2,
  },
  {
    key: 'aiDefaultMaxOutputTokens',
    envVar: 'AI_DEFAULT_MAX_OUTPUT_TOKENS',
    kind: 'int',
    defaultValue: 4096,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'embeddingDebounceMs',
    envVar: 'EMBEDDING_DEBOUNCE_MS',
    kind: 'int',
    defaultValue: 30_000,
    allowEmptyString: false,
    min: 0,
  },
  {
    key: 'embeddingBatchMaxWaitMs',
    envVar: 'EMBEDDING_BATCH_MAX_WAIT_MS',
    kind: 'int',
    defaultValue: 300_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'yjsPersistenceFlushMs',
    envVar: 'YJS_PERSISTENCE_FLUSH_MS',
    kind: 'int',
    defaultValue: 2000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'yjsVersionIntervalMs',
    envVar: 'YJS_VERSION_INTERVAL_MS',
    kind: 'int',
    defaultValue: 300000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'searchDefaultLimit',
    envVar: 'SEARCH_DEFAULT_LIMIT',
    kind: 'int',
    defaultValue: 8,
    allowEmptyString: false,
    min: 1,
    max: 100,
  },
  {
    key: 'searchMaxLimit',
    envVar: 'SEARCH_MAX_LIMIT',
    kind: 'int',
    defaultValue: 20,
    allowEmptyString: false,
    min: 1,
    max: 200,
  },
  {
    key: 'searchMaxQueryChars',
    envVar: 'SEARCH_MAX_QUERY_CHARS',
    kind: 'int',
    defaultValue: 400,
    allowEmptyString: false,
    min: 1,
    max: 10000,
  },
  {
    key: 'searchSnippetDefaultLimit',
    envVar: 'SEARCH_SNIPPET_DEFAULT_LIMIT',
    kind: 'int',
    defaultValue: 8,
    allowEmptyString: false,
    min: 1,
    max: 20,
  },
  {
    key: 'searchSnippetMaxLimit',
    envVar: 'SEARCH_SNIPPET_MAX_LIMIT',
    kind: 'int',
    defaultValue: 10,
    allowEmptyString: false,
    min: 1,
    max: 50,
  },
  {
    key: 'searchSnippetMaxLength',
    envVar: 'SEARCH_SNIPPET_MAX_LENGTH',
    kind: 'int',
    defaultValue: 180,
    allowEmptyString: false,
    min: 50,
    max: 1000,
  },
  {
    key: 'maxContextChars',
    envVar: 'LIMITS_CONTEXT_CHARS',
    kind: 'int',
    defaultValue: 1_000_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxPromptChars',
    envVar: 'LIMITS_PROMPT_CHARS',
    kind: 'int',
    defaultValue: 50_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxToolEntries',
    envVar: 'LIMITS_TOOL_ENTRIES',
    kind: 'int',
    defaultValue: 2_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxToolReadChars',
    envVar: 'LIMITS_TOOL_READ_CHARS',
    kind: 'int',
    defaultValue: 120_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxAiToolSteps',
    envVar: 'LIMITS_AI_TOOL_STEPS',
    kind: 'int',
    defaultValue: INLINE_AI_DEFAULT_TOOL_STEP_LIMIT,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxChatMessageChars',
    envVar: 'LIMITS_CHAT_MESSAGE_CHARS',
    kind: 'int',
    defaultValue: 20_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxPromptNameChars',
    envVar: 'LIMITS_PROMPT_NAME_CHARS',
    kind: 'int',
    defaultValue: 160,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxPromptDescChars',
    envVar: 'LIMITS_PROMPT_DESC_CHARS',
    kind: 'int',
    defaultValue: 2_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxPromptSystemChars',
    envVar: 'LIMITS_PROMPT_SYSTEM_CHARS',
    kind: 'int',
    defaultValue: 80_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxPromptUserChars',
    envVar: 'LIMITS_PROMPT_USER_CHARS',
    kind: 'int',
    defaultValue: 200_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxDocImportChars',
    envVar: 'LIMITS_DOC_IMPORT_CHARS',
    kind: 'int',
    defaultValue: 500_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxDocExportChars',
    envVar: 'LIMITS_DOC_EXPORT_CHARS',
    kind: 'int',
    defaultValue: 1_000_000,
    allowEmptyString: false,
    min: 1,
  },
  {
    key: 'maxPromptExcerptChars',
    envVar: 'LIMITS_PROMPT_EXCERPT_CHARS',
    kind: 'int',
    defaultValue: DEFAULT_PROMPT_EXCERPT_CHARS,
    allowEmptyString: false,
    min: MIN_PROMPT_EXCERPT_CHARS,
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
  'embeddingDebounceMs',
  'embeddingBatchMaxWaitMs',
  'yjsPersistenceFlushMs',
  'yjsVersionIntervalMs',
  'searchDefaultLimit',
  'searchMaxLimit',
  'searchMaxQueryChars',
  'searchSnippetDefaultLimit',
  'searchSnippetMaxLimit',
  'searchSnippetMaxLength',
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
  'maxPromptExcerptChars',
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
  'maxPromptExcerptChars',
] as const satisfies ReadonlyArray<PersistedConfigKey>

export const SEARCH_CONFIG_KEYS = [
  'searchDefaultLimit',
  'searchMaxLimit',
  'searchMaxQueryChars',
  'searchSnippetDefaultLimit',
  'searchSnippetMaxLimit',
  'searchSnippetMaxLength',
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
  promptExcerptChars: number
}

export interface SearchConfig {
  defaultLimit: number
  maxLimit: number
  maxQueryChars: number
  snippetDefaultLimit: number
  snippetMaxLimit: number
  snippetMaxLength: number
}

const yjsPersistenceFlushField = CONFIG_FIELD_BY_KEY.yjsPersistenceFlushMs
const yjsVersionIntervalField = CONFIG_FIELD_BY_KEY.yjsVersionIntervalMs
const searchDefaultLimitField = CONFIG_FIELD_BY_KEY.searchDefaultLimit
const searchMaxLimitField = CONFIG_FIELD_BY_KEY.searchMaxLimit
const searchMaxQueryCharsField = CONFIG_FIELD_BY_KEY.searchMaxQueryChars
const searchSnippetDefaultLimitField = CONFIG_FIELD_BY_KEY.searchSnippetDefaultLimit
const searchSnippetMaxLimitField = CONFIG_FIELD_BY_KEY.searchSnippetMaxLimit
const searchSnippetMaxLengthField = CONFIG_FIELD_BY_KEY.searchSnippetMaxLength
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
const limitsPromptExcerptCharsField = CONFIG_FIELD_BY_KEY.maxPromptExcerptChars

const aiDefaultTempField = CONFIG_FIELD_BY_KEY.aiDefaultTemperature
const aiSelEditTempField = CONFIG_FIELD_BY_KEY.aiSelectionEditTemperature
const aiDefaultMaxTokensField = CONFIG_FIELD_BY_KEY.aiDefaultMaxOutputTokens
const embeddingDebounceField = CONFIG_FIELD_BY_KEY.embeddingDebounceMs
const embeddingBatchMaxWaitField = CONFIG_FIELD_BY_KEY.embeddingBatchMaxWaitMs

export const editableConfigSchema = z
  .object({
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
    embeddingDebounceMs: z
      .number()
      .int()
      .min(embeddingDebounceField.min ?? 0),
    embeddingBatchMaxWaitMs: z
      .number()
      .int()
      .min(embeddingBatchMaxWaitField.min ?? 1),
    yjsPersistenceFlushMs: z
      .number()
      .int()
      .min(yjsPersistenceFlushField.min ?? 1),
    yjsVersionIntervalMs: z
      .number()
      .int()
      .min(yjsVersionIntervalField.min ?? 1),
    searchDefaultLimit: z
      .number()
      .int()
      .min(searchDefaultLimitField.min ?? 1)
      .max(searchDefaultLimitField.max ?? 100),
    searchMaxLimit: z
      .number()
      .int()
      .min(searchMaxLimitField.min ?? 1)
      .max(searchMaxLimitField.max ?? 200),
    searchMaxQueryChars: z
      .number()
      .int()
      .min(searchMaxQueryCharsField.min ?? 1)
      .max(searchMaxQueryCharsField.max ?? 10000),
    searchSnippetDefaultLimit: z
      .number()
      .int()
      .min(searchSnippetDefaultLimitField.min ?? 1)
      .max(searchSnippetDefaultLimitField.max ?? 20),
    searchSnippetMaxLimit: z
      .number()
      .int()
      .min(searchSnippetMaxLimitField.min ?? 1)
      .max(searchSnippetMaxLimitField.max ?? 50),
    searchSnippetMaxLength: z
      .number()
      .int()
      .min(searchSnippetMaxLengthField.min ?? 50)
      .max(searchSnippetMaxLengthField.max ?? 1000),
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
    maxPromptExcerptChars: z
      .number()
      .int()
      .min(limitsPromptExcerptCharsField.min ?? MIN_PROMPT_EXCERPT_CHARS)
      .max(limitsPromptExcerptCharsField.max ?? 50_000),
  })
  .superRefine((value, context) => {
    if (value.maxPromptExcerptChars > value.maxContextChars) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxPromptExcerptChars'],
        message: 'maxPromptExcerptChars must be less than or equal to maxContextChars.',
      })
    }
  })

export type EditableConfigInput = z.infer<typeof editableConfigSchema>
