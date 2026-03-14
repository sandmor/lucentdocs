import { z } from 'zod/v4'
import {
  AI_MODEL_SOURCE_TYPES,
  EDITABLE_CONFIG_KEYS,
  PERSISTED_CONFIG_KEYS,
  editableConfigSchema,
  normalizeBaseURL,
  parseAndNormalizeHttpBaseURL,
  type PersistedAppConfig,
} from '@lucentdocs/shared'
import { type ConfigStateSnapshot, type ConfigValueSource } from '../../config/manager.js'
import { configManager } from '../../config/runtime.js'
import { getModelsDevCatalog, getSourceModelCatalog } from '../../ai/model-catalog.js'
import { AI_PROVIDER_DEFAULT_BASE_URLS } from '../../core/ai/provider-types.js'
import { resetClient } from '../../ai/provider.js'
import { resetEmbeddingClient } from '../../embeddings/provider.js'
import { adminProcedure, publicProcedure, router } from '../index.js'

type EditableConfigKey = (typeof EDITABLE_CONFIG_KEYS)[number]

const PROVIDER_USAGE_SCHEMA = z.enum(['generation', 'embedding'])

const AI_RUNTIME_KEYS = [
  'aiDefaultTemperature',
  'aiSelectionEditTemperature',
  'aiDefaultMaxOutputTokens',
] as const
const EMBEDDING_RUNTIME_KEYS = ['embeddingDebounceMs', 'embeddingBatchMaxWaitMs'] as const
const YJS_RUNTIME_KEYS = ['yjsPersistenceFlushMs', 'yjsVersionIntervalMs'] as const

interface ConfigFieldPayload {
  effectiveValue: string | number | boolean
  persistedValue: string | number | boolean | null
  source: ConfigValueSource
  isOverridden: boolean
}

function isValidHttpBaseURL(value: string): boolean {
  return parseAndNormalizeHttpBaseURL(value).ok
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
      persistedValue: state.persistedConfig[key] ?? null,
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
      dataDir: state.config.paths.dataDir,
      isLoopbackHost: isLoopbackHost(host),
    },
  }
}

const sourceCatalogInputSchema = z.object({
  usage: PROVIDER_USAGE_SCHEMA,
  providerId: z.string().min(1),
  type: z.enum(AI_MODEL_SOURCE_TYPES),
  baseURL: z
    .string()
    .refine((value) => value.trim() === '' || isValidHttpBaseURL(value), 'Invalid base URL.'),
  apiKeyId: z.string().nullable().optional(),
  forceRefresh: z.boolean().optional(),
})

const aiProviderInputSchema = z.object({
  id: z.string().optional(),
  providerId: z.string().trim().min(1, 'Provider ID is required.'),
  type: z.enum(AI_MODEL_SOURCE_TYPES),
  baseURL: z
    .string()
    .refine((value) => value.trim() === '' || isValidHttpBaseURL(value), 'Invalid base URL.'),
  model: z.string().trim().min(1, 'Model is required.'),
  apiKeyId: z.string().nullable(),
})

const updateProvidersInputSchema = z.object({
  usage: PROVIDER_USAGE_SCHEMA,
  providers: z.array(aiProviderInputSchema).min(1),
  activeProviderId: z.string().nullable(),
})

const createApiKeyInputSchema = z.object({
  baseURL: z.string().min(1).refine(isValidHttpBaseURL, 'Invalid base URL.'),
  name: z.string().trim().optional(),
  apiKey: z.string().trim().min(1, 'API key is required.'),
  isDefault: z.boolean().optional(),
})

const updateApiKeyInputSchema = z.object({
  id: z.string(),
  name: z.string().trim().optional(),
  apiKey: z.string().trim().optional(),
  isDefault: z.boolean().optional(),
})

const deleteApiKeyInputSchema = z.object({
  id: z.string(),
})

export const configRouter = router({
  get: publicProcedure.query(() => {
    const state = configManager.getState()
    return buildConfigPayload(state)
  }),

  modelCatalog: adminProcedure.query(async () => {
    try {
      return {
        providers: await getModelsDevCatalog(),
      }
    } catch {
      return {
        providers: [],
      }
    }
  }),

  aiSettings: adminProcedure.query(async ({ ctx }) => {
    return ctx.services.aiSettings.getSnapshot()
  }),

  updateProviders: adminProcedure
    .input(updateProvidersInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.services.aiSettings.updateSettings({
        usage: input.usage,
        providers: input.providers.map((provider) => ({
          id: provider.id,
          providerId: provider.providerId.trim(),
          type: provider.type,
          baseURL: normalizeBaseURL(provider.baseURL),
          model: provider.model.trim(),
          apiKeyId: provider.apiKeyId,
        })),
        activeProviderId: input.activeProviderId,
      })

      if (input.usage === 'generation') {
        resetClient()
      } else {
        resetEmbeddingClient()
      }

      return result
    }),

  createAiApiKey: adminProcedure.input(createApiKeyInputSchema).mutation(async ({ ctx, input }) => {
    const result = await ctx.services.aiSettings.createApiKey({
      baseURL: normalizeBaseURL(input.baseURL),
      name: input.name?.trim() ?? '',
      apiKey: input.apiKey.trim(),
      isDefault: input.isDefault,
    })

    resetClient()
    resetEmbeddingClient()
    return result
  }),

  updateAiApiKey: adminProcedure.input(updateApiKeyInputSchema).mutation(async ({ ctx, input }) => {
    const result = await ctx.services.aiSettings.updateApiKey({
      id: input.id,
      name: input.name?.trim(),
      apiKey: input.apiKey?.trim(),
      isDefault: input.isDefault,
    })

    resetClient()
    resetEmbeddingClient()
    return result
  }),

  deleteAiApiKey: adminProcedure.input(deleteApiKeyInputSchema).mutation(async ({ ctx, input }) => {
    const result = await ctx.services.aiSettings.deleteApiKey(input.id)
    resetClient()
    resetEmbeddingClient()
    return result
  }),

  sourceCatalog: adminProcedure.input(sourceCatalogInputSchema).query(async ({ ctx, input }) => {
    const baseURL = normalizeBaseURL(input.baseURL) || AI_PROVIDER_DEFAULT_BASE_URLS[input.type]
    let apiKey = ''

    if (input.apiKeyId) {
      const snapshot = await ctx.services.aiSettings.getSnapshot()
      const selected = snapshot.apiKeys.find((entry) => entry.id === input.apiKeyId)
      if (!selected) {
        throw new Error('Selected API key was not found.')
      }

      if (normalizeBaseURL(selected.baseURL) !== baseURL) {
        throw new Error('Selected API key does not match the provider base URL.')
      }

      apiKey = (await ctx.services.aiSettings.resolveApiKeyById(input.apiKeyId)) ?? ''
    } else {
      apiKey = (await ctx.services.aiSettings.resolveApiKeyForBaseURL(baseURL)) ?? ''
    }

    return getSourceModelCatalog(
      {
        providerId: input.providerId,
        type: input.type,
        baseURL,
      },
      apiKey,
      input.usage,
      {
        forceRefresh: input.forceRefresh === true,
      }
    )
  }),

  update: adminProcedure.input(editableConfigSchema).mutation(({ ctx, input }) => {
    const sanitizedInput: Pick<PersistedAppConfig, EditableConfigKey> = {
      aiDefaultTemperature: input.aiDefaultTemperature,
      aiSelectionEditTemperature: input.aiSelectionEditTemperature,
      aiDefaultMaxOutputTokens: input.aiDefaultMaxOutputTokens,
      embeddingDebounceMs: input.embeddingDebounceMs,
      embeddingBatchMaxWaitMs: input.embeddingBatchMaxWaitMs,
      yjsPersistenceFlushMs: input.yjsPersistenceFlushMs,
      yjsVersionIntervalMs: input.yjsVersionIntervalMs,
      searchDefaultLimit: input.searchDefaultLimit,
      searchMaxLimit: input.searchMaxLimit,
      searchMaxQueryChars: input.searchMaxQueryChars,
      searchSnippetDefaultLimit: input.searchSnippetDefaultLimit,
      searchSnippetMaxLimit: input.searchSnippetMaxLimit,
      searchSnippetMaxLength: input.searchSnippetMaxLength,
      maxContextChars: input.maxContextChars,
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
      maxDocImportBatchDocs: input.maxDocImportBatchDocs,
      maxDocImportBatchChars: input.maxDocImportBatchChars,
      maxDocExportChars: input.maxDocExportChars,
      maxPromptExcerptChars: input.maxPromptExcerptChars,
    }

    const result = configManager.updatePersistedConfig(sanitizedInput)
    const changedEffectiveSet = new Set(result.changedEffectiveKeys)

    if (AI_RUNTIME_KEYS.some((key) => changedEffectiveSet.has(key))) {
      resetClient()
    }

    if (EMBEDDING_RUNTIME_KEYS.some((key) => changedEffectiveSet.has(key))) {
      resetEmbeddingClient()
      const config = configManager.getConfig()
      ctx.embeddingRuntime.reloadConfig({
        debounceMs: config.embeddings.debounceMs,
        batchMaxWaitMs: config.embeddings.batchMaxWaitMs,
      })
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
      changedPersistedKeys: result.changedPersistedKeys,
      changedEffectiveKeys: result.changedEffectiveKeys,
      overriddenChangedKeys: result.overriddenChangedKeys,
    }
  }),

  limits: adminProcedure.query(() => {
    return configManager.getConfig().limits
  }),
})
