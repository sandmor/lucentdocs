import { nanoid } from 'nanoid'
import type { AiModelSourceType } from '@lucentdocs/shared'
import type { RepositorySet } from '../../core/ports/types.js'
import type { TransactionPort } from '../../core/ports/transaction.port.js'
import type { AiApiKeyEntity, AiProviderConfigEntity } from '../../core/ports/aiSettings.port.js'
import type { AiProviderUsage } from '../ai/provider-usage.js'
import {
  isSameBaseURL,
  normalizeModelSourceType,
  normalizeProviderBaseURL,
  parseAndNormalizeHttpBaseURL,
} from '../ai/provider-types.js'

const DEFAULT_OPENAI_MODEL = 'gpt-5'
const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small'
const DEFAULT_OPENROUTER_EMBEDDING_MODEL = 'openai/text-embedding-3-small'

interface BootstrapProviderDefaults {
  providerId: string
  type: AiModelSourceType
  baseURL: string
  model: string
  apiKey: string | undefined
  apiKeyName: string | undefined
}

export interface AiProviderConfigRecord {
  id: string
  usage: AiProviderUsage
  providerId: string
  type: AiModelSourceType
  baseURL: string
  model: string
  apiKeyId: string | null
  sortOrder: number
}

export interface AiApiKeyRecord {
  id: string
  baseURL: string
  name: string
  maskedKey: string
  isDefault: boolean
  updatedAt: number
}

export interface AiSettingsSnapshot {
  generationProviders: AiProviderConfigRecord[]
  activeGenerationProviderId: string | null
  embeddingProviders: AiProviderConfigRecord[]
  activeEmbeddingProviderId: string | null
  apiKeys: AiApiKeyRecord[]
}

export interface RuntimeProviderSelection {
  providerConfigId: string
  providerId: string
  type: AiModelSourceType
  baseURL: string
  model: string
  apiKey: string
}

export interface AiSettingsService {
  initializeDefaults(options?: { env?: NodeJS.ProcessEnv }): Promise<void>
  getSnapshot(): Promise<AiSettingsSnapshot>
  updateSettings(input: {
    usage: AiProviderUsage
    providers: Array<{
      id?: string
      providerId: string
      type: AiModelSourceType
      baseURL: string
      model: string
      apiKeyId: string | null
    }>
    activeProviderId: string | null
  }): Promise<AiSettingsSnapshot>
  createApiKey(input: {
    baseURL: string
    name: string
    apiKey: string
    isDefault?: boolean
  }): Promise<AiSettingsSnapshot>
  updateApiKey(input: {
    id: string
    name?: string
    apiKey?: string
    isDefault?: boolean
  }): Promise<AiSettingsSnapshot>
  deleteApiKey(id: string): Promise<AiSettingsSnapshot>
  resolveRuntimeSelection(usage: AiProviderUsage): Promise<RuntimeProviderSelection>
  resolveApiKeyForBaseURL(baseURL: string): Promise<string | null>
  resolveApiKeyById(id: string): Promise<string | null>
}

function normalizeModel(model: string): string {
  const trimmed = model.trim()
  return trimmed || DEFAULT_OPENAI_MODEL
}

function normalizeModelForUsage(
  usage: AiProviderUsage,
  type: AiModelSourceType,
  model: string
): string {
  const trimmed = model.trim()
  return trimmed || defaultModelForUsage(usage, type)
}

function normalizeProviderId(type: AiModelSourceType, providerId: string): string {
  const trimmed = providerId.trim()
  if (trimmed) return trimmed
  if (type === 'anthropic') return 'anthropic'
  if (type === 'openrouter') return 'openrouter'
  return 'openai'
}

function defaultModelForUsage(usage: AiProviderUsage, type: AiModelSourceType): string {
  if (usage === 'embedding') {
    return type === 'openrouter'
      ? DEFAULT_OPENROUTER_EMBEDDING_MODEL
      : DEFAULT_OPENAI_EMBEDDING_MODEL
  }
  if (type === 'anthropic') return 'claude-sonnet-4-5'
  return DEFAULT_OPENAI_MODEL
}

function resolveBootstrapProviderDefaults(env: NodeJS.ProcessEnv): BootstrapProviderDefaults {
  const envBaseURL = readTrimmedEnvValue(env, 'AI_BASE_URL') ?? ''
  const envModel = readTrimmedEnvValue(env, 'AI_MODEL') ?? ''
  const envProviderType =
    readTrimmedEnvValue(env, 'AI_PROVIDER_TYPE') ?? readTrimmedEnvValue(env, 'AI_PROVIDER')
  const type = envProviderType
    ? normalizeModelSourceType(envProviderType)
    : inferBootstrapProviderType(envBaseURL, envModel)
  const providerId = normalizeProviderId(type, readTrimmedEnvValue(env, 'AI_PROVIDER_ID') ?? '')

  return {
    providerId,
    type,
    baseURL: resolveProviderBaseURLOrThrow(type, envBaseURL),
    model: normalizeModel(envModel || defaultModelForUsage('generation', type)),
    apiKey: readTrimmedEnvValue(env, 'AI_API_KEY'),
    apiKeyName: readTrimmedEnvValue(env, 'AI_API_KEY_NAME'),
  }
}

function resolveEmbeddingBootstrapSource(source: {
  providerId: string
  type: AiModelSourceType
  baseURL: string
}): {
  providerId: string
  type: AiModelSourceType
  baseURL: string
} {
  if (source.type !== 'anthropic') {
    return source
  }

  return {
    providerId: 'openrouter',
    type: 'openrouter',
    baseURL: resolveProviderBaseURLOrThrow('openrouter', ''),
  }
}

function selectApiKeyIdForBaseURL(
  apiKeys: AiApiKeyEntity[],
  baseURL: string,
  preferredApiKeyId: string | null = null
): string | null {
  const matchingKeys = apiKeys.filter((key) => isSameBaseURL(key.baseURL, baseURL))
  if (matchingKeys.length === 0) return null

  if (preferredApiKeyId) {
    const preferred = matchingKeys.find((key) => key.id === preferredApiKeyId)
    if (preferred) return preferred.id
  }

  return matchingKeys.find((key) => key.isDefault)?.id ?? matchingKeys[0]?.id ?? null
}

function requireProviderId(providerId: string): string {
  const trimmed = providerId.trim()
  if (!trimmed) {
    throw new Error('Provider ID is required.')
  }
  return trimmed
}

function requireModel(model: string): string {
  const trimmed = model.trim()
  if (!trimmed) {
    throw new Error('Model is required.')
  }
  return trimmed
}

function maskApiKey(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 6) return '***'
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`
}

function sortProviders(left: AiProviderConfigEntity, right: AiProviderConfigEntity): number {
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
  return left.createdAt - right.createdAt
}

function sortApiKeys(left: AiApiKeyEntity, right: AiApiKeyEntity): number {
  const byBase = left.baseURL.localeCompare(right.baseURL)
  if (byBase !== 0) return byBase
  if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1
  return right.updatedAt - left.updatedAt
}

function readTrimmedEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key]
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed ? trimmed : undefined
}

function inferBootstrapProviderType(baseURL: string, model: string): AiModelSourceType {
  const lowerBaseURL = baseURL.toLowerCase()
  const lowerModel = model.toLowerCase()
  if (lowerBaseURL.includes('anthropic') || lowerModel.startsWith('claude')) {
    return 'anthropic'
  }
  if (lowerBaseURL.includes('openrouter')) {
    return 'openrouter'
  }
  return 'openai'
}

function resolveProviderBaseURLOrThrow(type: AiModelSourceType, baseURL: string): string {
  const result = normalizeProviderBaseURL(type, baseURL)
  if (!result.ok || !result.value) {
    throw new Error(result.error ?? 'Invalid provider base URL.')
  }
  return result.value
}

function resolveApiKeyBaseURLOrThrow(baseURL: string): string {
  const result = parseAndNormalizeHttpBaseURL(baseURL)
  if (!result.ok || !result.value) {
    throw new Error(result.error ?? 'Invalid API key base URL.')
  }
  return result.value
}

function isDefaultKeyUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('unique constraint failed: ai_api_keys.baseurl') ||
    message.includes('idx_ai_api_keys_single_default')
  )
}

function rethrowDefaultKeyConflict(error: unknown): never {
  if (isDefaultKeyUniqueConstraintError(error)) {
    throw new Error('Another default API key update happened concurrently. Retry your request.')
  }
  throw error
}

export function createAiSettingsService(
  repos: RepositorySet,
  transaction: TransactionPort
): AiSettingsService {
  async function getProviders(usage: AiProviderUsage): Promise<AiProviderConfigEntity[]> {
    const providers = await repos.aiSettings.listProviderConfigs(usage)
    return [...providers].sort(sortProviders)
  }

  async function getApiKeys(): Promise<AiApiKeyEntity[]> {
    const keys = await repos.aiSettings.listApiKeys()
    return [...keys].sort(sortApiKeys)
  }

  function selectActiveProviderId(
    providers: AiProviderConfigEntity[],
    activeProviderId: string | null
  ): string | null {
    if (activeProviderId && providers.some((provider) => provider.id === activeProviderId)) {
      return activeProviderId
    }
    return providers[0]?.id ?? null
  }

  async function readRuntimeSelections(): Promise<{
    activeGenerationProviderId: string | null
    activeEmbeddingProviderId: string | null
  }> {
    const runtime = await repos.aiSettings.readRuntimeSettings()
    return {
      activeGenerationProviderId: runtime?.activeGenerationProviderId ?? null,
      activeEmbeddingProviderId: runtime?.activeEmbeddingProviderId ?? null,
    }
  }

  return {
    async initializeDefaults(options?: { env?: NodeJS.ProcessEnv }): Promise<void> {
      const env = options?.env ?? process.env

      await transaction.run(async () => {
        const bootstrapDefaults = resolveBootstrapProviderDefaults(env)
        let generationProviders = await repos.aiSettings.listProviderConfigs('generation')
        let embeddingProviders = await repos.aiSettings.listProviderConfigs('embedding')
        const apiKeys = await repos.aiSettings.listApiKeys()
        const runtime = await readRuntimeSelections()
        const now = Date.now()

        let bootstrapApiKeyId = selectApiKeyIdForBaseURL(apiKeys, bootstrapDefaults.baseURL)
        if (bootstrapDefaults.apiKey && !bootstrapApiKeyId) {
          bootstrapApiKeyId = nanoid()
          const bootstrapKey: AiApiKeyEntity = {
            id: bootstrapApiKeyId,
            baseURL: bootstrapDefaults.baseURL,
            name: bootstrapDefaults.apiKeyName ?? 'Bootstrap key',
            apiKey: bootstrapDefaults.apiKey,
            isDefault: true,
            createdAt: now,
            updatedAt: now,
          }

          await repos.aiSettings.clearDefaultApiKeys(bootstrapDefaults.baseURL, now)
          await repos.aiSettings.insertApiKey({
            ...bootstrapKey,
          })
          apiKeys.push(bootstrapKey)
        }

        if (generationProviders.length === 0) {
          const providerConfigId = nanoid()
          const generationProvider: AiProviderConfigEntity = {
            id: providerConfigId,
            usage: 'generation',
            providerId: bootstrapDefaults.providerId,
            type: bootstrapDefaults.type,
            baseURL: bootstrapDefaults.baseURL,
            model: bootstrapDefaults.model,
            apiKeyId: bootstrapApiKeyId,
            sortOrder: 0,
            createdAt: now,
            updatedAt: now,
          }

          await repos.aiSettings.upsertProviderConfig(generationProvider)
          generationProviders = [generationProvider]
        }

        if (embeddingProviders.length === 0) {
          const embeddingSource = resolveEmbeddingBootstrapSource(
            generationProviders[0] ?? bootstrapDefaults
          )
          const embeddingProviderConfigId = nanoid()
          const embeddingProvider: AiProviderConfigEntity = {
            id: embeddingProviderConfigId,
            usage: 'embedding',
            providerId: embeddingSource.providerId,
            type: embeddingSource.type,
            baseURL: embeddingSource.baseURL,
            model: defaultModelForUsage('embedding', embeddingSource.type),
            apiKeyId: selectApiKeyIdForBaseURL(
              apiKeys,
              embeddingSource.baseURL,
              generationProviders[0]?.apiKeyId ?? bootstrapApiKeyId
            ),
            sortOrder: 0,
            createdAt: now,
            updatedAt: now,
          }

          await repos.aiSettings.upsertProviderConfig(embeddingProvider)
          embeddingProviders = [embeddingProvider]
        }

        await repos.aiSettings.upsertRuntimeSettings({
          activeGenerationProviderId: selectActiveProviderId(
            generationProviders,
            runtime.activeGenerationProviderId
          ),
          activeEmbeddingProviderId: selectActiveProviderId(
            embeddingProviders,
            runtime.activeEmbeddingProviderId
          ),
          updatedAt: now,
        })
      })
    },

    async getSnapshot(): Promise<AiSettingsSnapshot> {
      const generationProviders = await getProviders('generation')
      const embeddingProviders = await getProviders('embedding')
      const runtime = await readRuntimeSelections()
      const apiKeys = await getApiKeys()
      const resolveSnapshotApiKeyId = (provider: AiProviderConfigEntity): string | null => {
        if (!provider.apiKeyId) return null
        const key = apiKeys.find((entry) => entry.id === provider.apiKeyId)
        return key && isSameBaseURL(key.baseURL, provider.baseURL) ? key.id : null
      }

      return {
        generationProviders: generationProviders.map((provider) => ({
          id: provider.id,
          usage: provider.usage,
          providerId: normalizeProviderId(provider.type, provider.providerId),
          type: normalizeModelSourceType(provider.type),
          baseURL: resolveProviderBaseURLOrThrow(provider.type, provider.baseURL),
          model: normalizeModelForUsage(provider.usage, provider.type, provider.model),
          apiKeyId: resolveSnapshotApiKeyId(provider),
          sortOrder: provider.sortOrder,
        })),
        activeGenerationProviderId: selectActiveProviderId(
          generationProviders,
          runtime.activeGenerationProviderId
        ),
        embeddingProviders: embeddingProviders.map((provider) => ({
          id: provider.id,
          usage: provider.usage,
          providerId: normalizeProviderId(provider.type, provider.providerId),
          type: normalizeModelSourceType(provider.type),
          baseURL: resolveProviderBaseURLOrThrow(provider.type, provider.baseURL),
          model: normalizeModelForUsage(provider.usage, provider.type, provider.model),
          apiKeyId: resolveSnapshotApiKeyId(provider),
          sortOrder: provider.sortOrder,
        })),
        activeEmbeddingProviderId: selectActiveProviderId(
          embeddingProviders,
          runtime.activeEmbeddingProviderId
        ),
        apiKeys: apiKeys.map((key) => ({
          id: key.id,
          baseURL: key.baseURL,
          name: key.name,
          maskedKey: maskApiKey(key.apiKey),
          isDefault: key.isDefault,
          updatedAt: key.updatedAt,
        })),
      }
    },

    async updateSettings(input): Promise<AiSettingsSnapshot> {
      if (input.providers.length === 0) {
        throw new Error('At least one provider configuration is required.')
      }

      const existingProviders = await repos.aiSettings.listProviderConfigs(input.usage)
      const existingById = new Map(existingProviders.map((provider) => [provider.id, provider]))
      const seenIds = new Set<string>()
      const now = Date.now()

      const nextRows = input.providers.map((provider, index) => {
        const type = normalizeModelSourceType(provider.type)
        const id = provider.id?.trim() || nanoid()
        if (seenIds.has(id)) {
          throw new Error(`Duplicate provider config id "${id}" in update payload.`)
        }
        seenIds.add(id)

        const previous = existingById.get(id)

        return {
          id,
          usage: input.usage,
          providerId: requireProviderId(provider.providerId),
          type,
          baseURL: resolveProviderBaseURLOrThrow(type, provider.baseURL),
          model: requireModel(provider.model),
          apiKeyId: provider.apiKeyId,
          sortOrder: index,
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
        }
      })

      await transaction.run(async () => {
        for (const row of nextRows) {
          if (!row.apiKeyId) continue

          const key = await repos.aiSettings.findApiKeyById(row.apiKeyId)
          if (!key) {
            throw new Error('Selected API key was not found.')
          }

          if (!isSameBaseURL(key.baseURL, row.baseURL)) {
            throw new Error('Selected API key does not match the provider base URL.')
          }
        }

        await repos.aiSettings.deleteProviderConfigsNotIn(
          input.usage,
          nextRows.map((row) => row.id)
        )
        for (const row of nextRows) {
          await repos.aiSettings.upsertProviderConfig(row)
        }

        const currentRuntime = await readRuntimeSelections()
        const requestedActive = input.activeProviderId
        const nextActiveProviderId = nextRows.some((row) => row.id === requestedActive)
          ? requestedActive
          : (nextRows[0]?.id ?? null)

        await repos.aiSettings.upsertRuntimeSettings({
          activeGenerationProviderId:
            input.usage === 'generation'
              ? nextActiveProviderId
              : currentRuntime.activeGenerationProviderId,
          activeEmbeddingProviderId:
            input.usage === 'embedding'
              ? nextActiveProviderId
              : currentRuntime.activeEmbeddingProviderId,
          updatedAt: now,
        })
      })

      return this.getSnapshot()
    },

    async createApiKey(input): Promise<AiSettingsSnapshot> {
      const normalizedBaseURL = resolveApiKeyBaseURLOrThrow(input.baseURL)
      const name = input.name.trim()
      const apiKey = input.apiKey.trim()

      if (!apiKey) {
        throw new Error('API key is required.')
      }

      const now = Date.now()
      const id = nanoid()

      try {
        await transaction.run(async () => {
          const keys = (await repos.aiSettings.listApiKeys()).filter((key) =>
            isSameBaseURL(key.baseURL, normalizedBaseURL)
          )
          const isDefault = input.isDefault === true || keys.length === 0

          if (isDefault) {
            await repos.aiSettings.clearDefaultApiKeys(normalizedBaseURL, now)
          }

          await repos.aiSettings.insertApiKey({
            id,
            baseURL: normalizedBaseURL,
            name: name || `Key ${new Date(now).toISOString()}`,
            apiKey,
            isDefault,
            createdAt: now,
            updatedAt: now,
          })
        })
      } catch (error) {
        rethrowDefaultKeyConflict(error)
      }

      return this.getSnapshot()
    },

    async updateApiKey(input): Promise<AiSettingsSnapshot> {
      const current = await repos.aiSettings.findApiKeyById(input.id)
      if (!current) {
        throw new Error('Selected API key was not found.')
      }

      const now = Date.now()
      const nextName = input.name !== undefined ? input.name.trim() : current.name
      const nextSecret = input.apiKey !== undefined ? input.apiKey.trim() : current.apiKey

      if (!nextSecret) {
        throw new Error('API key cannot be empty.')
      }

      try {
        await transaction.run(async () => {
          if (input.isDefault === true) {
            await repos.aiSettings.clearDefaultApiKeys(current.baseURL, now)
          }

          await repos.aiSettings.updateApiKey(input.id, {
            name: nextName || current.name,
            apiKey: nextSecret,
            isDefault: input.isDefault ?? current.isDefault,
            updatedAt: now,
          })
        })
      } catch (error) {
        rethrowDefaultKeyConflict(error)
      }

      return this.getSnapshot()
    },

    async deleteApiKey(id: string): Promise<AiSettingsSnapshot> {
      const key = await repos.aiSettings.findApiKeyById(id)
      if (!key) {
        throw new Error('Selected API key was not found.')
      }

      try {
        const now = Date.now()
        await transaction.run(async () => {
          await repos.aiSettings.deleteApiKey(id)
          await repos.aiSettings.clearProviderApiKeyReferences(id, now)

          if (key.isDefault) {
            const replacement = (await repos.aiSettings.listApiKeys())
              .filter((candidate) => isSameBaseURL(candidate.baseURL, key.baseURL))
              .sort((left, right) => right.updatedAt - left.updatedAt)[0]

            if (replacement) {
              await repos.aiSettings.setApiKeyDefault(replacement.id, true, now)
            }
          }
        })
      } catch (error) {
        rethrowDefaultKeyConflict(error)
      }

      return this.getSnapshot()
    },

    async resolveRuntimeSelection(usage: AiProviderUsage): Promise<RuntimeProviderSelection> {
      const snapshot = await this.getSnapshot()
      const providers =
        usage === 'embedding' ? snapshot.embeddingProviders : snapshot.generationProviders
      const activeProviderId =
        usage === 'embedding'
          ? snapshot.activeEmbeddingProviderId
          : snapshot.activeGenerationProviderId
      const active = providers.find((provider) => provider.id === activeProviderId) ?? providers[0]

      if (!active) {
        throw new Error('No active provider is configured.')
      }

      const keyRows = (await repos.aiSettings.listApiKeys()).filter((row) =>
        isSameBaseURL(row.baseURL, active.baseURL)
      )

      let selectedKey: AiApiKeyEntity | undefined
      if (active.apiKeyId) {
        selectedKey = keyRows.find((row) => row.id === active.apiKeyId)
      }
      if (!selectedKey) {
        selectedKey = keyRows.find((row) => row.isDefault) ?? keyRows[0]
      }

      if (!selectedKey) {
        return {
          providerConfigId: active.id,
          providerId: active.providerId,
          type: active.type,
          baseURL: active.baseURL,
          model: active.model,
          apiKey: '',
        }
      }

      return {
        providerConfigId: active.id,
        providerId: active.providerId,
        type: active.type,
        baseURL: active.baseURL,
        model: active.model,
        apiKey: selectedKey.apiKey,
      }
    },

    async resolveApiKeyForBaseURL(baseURL: string): Promise<string | null> {
      const parsed = parseAndNormalizeHttpBaseURL(baseURL)
      if (!parsed.ok || !parsed.value) return null

      const keys = (await repos.aiSettings.listApiKeys()).filter((row) =>
        isSameBaseURL(row.baseURL, parsed.value ?? '')
      )
      const selected = keys.find((row) => row.isDefault) ?? keys[0]
      return selected?.apiKey ?? null
    },

    async resolveApiKeyById(id: string): Promise<string | null> {
      const row = await repos.aiSettings.findApiKeyById(id)
      return row?.apiKey ?? null
    },
  }
}
