import {
  AI_PROVIDER_DEFAULT_BASE_URLS,
  DEFAULT_PERSISTED_CONFIG,
  EDITABLE_CONFIG_KEYS,
  normalizeBaseURL,
  parseAndNormalizeHttpBaseURL,
} from '@lucentdocs/shared'

import type {
  AiDraftState,
  AiProviderDraft,
  ConfigFormValues,
  ConfigQueryData,
  EditableFieldKey,
  FieldSource,
  ModelCatalogProvider,
  ModelCatalogProviderSummary,
  ProviderSectionKind,
  ProviderOption,
  VisibleNumberFieldKey,
} from './types'

export const DEFAULT_PROVIDER_OPTIONS: ProviderOption[] = [
  {
    value: 'openai',
    label: 'OpenAI',
    type: 'openai',
    apiBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.openai,
    iconURL: 'https://models.dev/logos/openai.svg',
    docURL: 'https://platform.openai.com/docs/models',
  },
  {
    value: 'anthropic',
    label: 'Anthropic',
    type: 'anthropic',
    apiBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.anthropic,
    iconURL: 'https://models.dev/logos/anthropic.svg',
    docURL: 'https://docs.anthropic.com/en/docs/about-claude/models',
  },
  {
    value: 'openrouter',
    label: 'OpenRouter',
    type: 'openrouter',
    apiBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.openrouter,
    iconURL: 'https://models.dev/logos/openrouter.svg',
    docURL: 'https://openrouter.ai/docs',
  },
  {
    value: 'custom',
    label: 'Custom (OpenAI-compatible)',
    type: 'openai',
    apiBaseURL: '',
    iconURL: 'https://models.dev/logos/openai.svg',
    docURL: null,
  },
]

export const DEFAULT_EMBEDDING_PROVIDER_OPTIONS: ProviderOption[] = [
  {
    value: 'openrouter',
    label: 'OpenRouter',
    type: 'openrouter',
    apiBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.openrouter,
    iconURL: 'https://models.dev/logos/openrouter.svg',
    docURL: 'https://openrouter.ai/docs/api-reference/embeddings/get-embedding-models',
  },
  {
    value: 'openai',
    label: 'OpenAI',
    type: 'openai',
    apiBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.openai,
    iconURL: 'https://models.dev/logos/openai.svg',
    docURL: 'https://platform.openai.com/docs/guides/embeddings',
  },
  {
    value: 'custom',
    label: 'Custom (OpenAI-compatible)',
    type: 'openai',
    apiBaseURL: '',
    iconURL: 'https://models.dev/logos/openai.svg',
    docURL: null,
  },
]

export const AI_TUNING_FIELD_KEYS = [
  'aiDefaultTemperature',
  'aiSelectionEditTemperature',
  'aiDefaultMaxOutputTokens',
] as const satisfies ReadonlyArray<VisibleNumberFieldKey>

export const EMBEDDING_RUNTIME_FIELD_KEYS = [
  'embeddingDebounceMs',
  'embeddingBatchMaxWaitMs',
] as const satisfies ReadonlyArray<VisibleNumberFieldKey>

export const COLLABORATION_FIELD_KEYS = [
  'yjsPersistenceFlushMs',
  'yjsVersionIntervalMs',
] as const satisfies ReadonlyArray<VisibleNumberFieldKey>

export const LIMIT_FIELD_ROWS = [
  {
    keys: ['maxContextChars', 'maxPromptChars'],
    columnsClassName: 'sm:grid-cols-2',
  },
  {
    keys: ['maxToolEntries', 'maxToolReadChars', 'maxAiToolSteps', 'maxChatMessageChars'],
    columnsClassName: 'sm:grid-cols-2',
  },
  {
    keys: [
      'maxPromptNameChars',
      'maxPromptDescChars',
      'maxPromptSystemChars',
      'maxPromptUserChars',
    ],
    columnsClassName: 'sm:grid-cols-2',
  },
  {
    keys: ['maxDocImportChars', 'maxDocExportChars'],
    columnsClassName: 'sm:grid-cols-2',
  },
] as const satisfies ReadonlyArray<{
  keys: ReadonlyArray<VisibleNumberFieldKey>
  columnsClassName: string
}>

export const VISIBLE_FIELD_META: Record<
  VisibleNumberFieldKey,
  {
    id: string
    label: string
    description: string
    overrideSuffix?: string
  }
> = {
  aiDefaultTemperature: {
    id: 'ai-default-temperature',
    label: 'Default Temperature',
    description:
      'Temperature for AI generation (0-2). Higher = more creative, lower = more deterministic.',
  },
  aiSelectionEditTemperature: {
    id: 'ai-selection-edit-temperature',
    label: 'Selection Edit Temperature',
    description: 'Temperature for inline AI edits (0-2). Lower values = more focused changes.',
  },
  aiDefaultMaxOutputTokens: {
    id: 'ai-default-max-output-tokens',
    label: 'Max Output Tokens',
    description: 'Default maximum tokens for AI responses.',
  },
  embeddingDebounceMs: {
    id: 'embedding-debounce-ms',
    label: 'Embedding debounce (ms)',
    description:
      'How long a changed document stays quiet before it becomes eligible for embedding.',
    overrideSuffix: ' ms',
  },
  embeddingBatchMaxWaitMs: {
    id: 'embedding-batch-max-wait-ms',
    label: 'Embedding max batch wait (ms)',
    description:
      'Maximum age of the oldest queued document before the pending embedding batch is flushed.',
    overrideSuffix: ' ms',
  },
  yjsPersistenceFlushMs: {
    id: 'flush-ms',
    label: 'Flush interval (ms)',
    description: 'How often dirty documents flush to SQLite.',
    overrideSuffix: ' ms',
  },
  yjsVersionIntervalMs: {
    id: 'snapshot-ms',
    label: 'Snapshot interval (ms)',
    description: 'How often active documents auto-create version snapshots.',
    overrideSuffix: ' ms',
  },
  maxContextChars: {
    id: 'max-context',
    label: 'Context chars',
    description: 'Max characters for AI context.',
  },
  maxPromptChars: {
    id: 'max-prompt',
    label: 'Prompt chars',
    description: 'Max characters for prompts.',
  },
  maxToolEntries: {
    id: 'max-tool-entries',
    label: 'Tool entries',
    description: 'Max entries returned by tools.',
  },
  maxToolReadChars: {
    id: 'max-tool-read',
    label: 'Tool read chars',
    description: 'Max characters read by tools.',
  },
  maxAiToolSteps: {
    id: 'max-ai-tool-steps',
    label: 'AI tool steps',
    description: 'Max tool-call steps per AI generation.',
  },
  maxChatMessageChars: {
    id: 'max-chat-msg',
    label: 'Chat message chars',
    description: 'Max characters per chat message.',
  },
  maxPromptNameChars: {
    id: 'max-prompt-name',
    label: 'Prompt name chars',
    description: 'Max prompt name length.',
  },
  maxPromptDescChars: {
    id: 'max-prompt-desc',
    label: 'Prompt desc chars',
    description: 'Max prompt description length.',
  },
  maxPromptSystemChars: {
    id: 'max-prompt-system',
    label: 'Prompt system chars',
    description: 'Max system prompt length.',
  },
  maxPromptUserChars: {
    id: 'max-prompt-user',
    label: 'Prompt user chars',
    description: 'Max user prompt length.',
  },
  maxDocImportChars: {
    id: 'max-doc-import',
    label: 'Doc import chars',
    description: 'Max characters for document import.',
  },
  maxDocExportChars: {
    id: 'max-doc-export',
    label: 'Doc export chars',
    description: 'Max characters for document export.',
  },
}

// Helper functions

export function sourceBadge(source: FieldSource): {
  label: string
  variant: 'outline' | 'secondary' | 'ghost'
} {
  if (source === 'env') return { label: 'Env Override', variant: 'outline' }
  if (source === 'database') return { label: 'Database', variant: 'secondary' }
  return { label: 'Default', variant: 'ghost' }
}

export function formatDisplayValue(value: string | number | boolean | null): string {
  if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled'
  if (typeof value === 'number') return value.toLocaleString()
  if (typeof value === 'string') return value || '(empty)'
  return '(unset)'
}

export function hasCatalogModels(
  value: ModelCatalogProviderSummary | ModelCatalogProvider | null
): value is ModelCatalogProvider {
  return Boolean(value && Array.isArray((value as { models?: unknown }).models))
}

export function isValidHttpBaseURL(value: string): boolean {
  return parseAndNormalizeHttpBaseURL(value).ok
}

export function normalizeProvider(provider: AiProviderDraft): AiProviderDraft {
  const type =
    provider.type === 'anthropic'
      ? 'anthropic'
      : provider.type === 'openrouter'
        ? 'openrouter'
        : 'openai'

  return {
    id: provider.id,
    providerId:
      provider.providerId.trim() ||
      (type === 'anthropic' ? 'anthropic' : type === 'openrouter' ? 'openrouter' : 'openai'),
    type,
    baseURL: provider.baseURL.trim() || AI_PROVIDER_DEFAULT_BASE_URLS[type],
    model: provider.model.trim(),
    apiKeyId: provider.apiKeyId,
  }
}

export function defaultModelForProvider(
  kind: ProviderSectionKind,
  type: ProviderOption['type']
): string {
  if (kind === 'embedding') {
    return type === 'openrouter' ? 'openai/text-embedding-3-small' : 'text-embedding-3-small'
  }

  return type === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-5'
}

export function createProviderDraft(
  kind: ProviderSectionKind,
  option: ProviderOption = kind === 'embedding'
    ? DEFAULT_EMBEDDING_PROVIDER_OPTIONS[0]
    : DEFAULT_PROVIDER_OPTIONS[0]
): AiProviderDraft {
  const type = option.type
  return {
    id: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    providerId: option.value,
    type,
    baseURL: option.apiBaseURL || AI_PROVIDER_DEFAULT_BASE_URLS[type],
    model: defaultModelForProvider(kind, type),
    apiKeyId: null,
  }
}

export function readFieldValue(
  data: ConfigQueryData | undefined,
  key: EditableFieldKey
): string | number | boolean {
  return data?.fields[key]?.persistedValue ?? DEFAULT_PERSISTED_CONFIG[key]
}

export function toFormValues(data: ConfigQueryData | undefined): ConfigFormValues {
  const values: Partial<Record<EditableFieldKey, string | number | boolean>> = {}

  for (const key of EDITABLE_CONFIG_KEYS) {
    const fallback = DEFAULT_PERSISTED_CONFIG[key]
    const rawValue = readFieldValue(data, key)

    if (typeof fallback === 'boolean') {
      values[key] = Boolean(rawValue)
    } else if (typeof fallback === 'number') {
      values[key] = Number(rawValue)
    } else {
      values[key] = String(rawValue)
    }
  }

  return values as ConfigFormValues
}

export function sourceCatalogCacheKey(
  kind: ProviderSectionKind,
  providerId: string,
  type: string,
  baseURL: string,
  apiKeyId: string | null
): string {
  return `${kind}|${providerId.trim().toLowerCase()}|${type}|${baseURL.trim().toLowerCase()}|${apiKeyId ?? 'none'}`
}

export function serializeAiDraft(draft: AiDraftState): string {
  return JSON.stringify({
    providers: draft.providers.map((provider) => ({
      id: provider.id,
      providerId: provider.providerId,
      type: provider.type,
      baseURL: provider.baseURL,
      model: provider.model,
      apiKeyId: provider.apiKeyId,
    })),
    activeProviderId: draft.activeProviderId,
  })
}

export function getUniqueProviderBaseURLs(providers: AiProviderDraft[]): string[] {
  return Array.from(
    new Set(
      providers
        .map((provider) => normalizeBaseURL(provider.baseURL))
        .filter((value) => value.length > 0)
    )
  )
}
