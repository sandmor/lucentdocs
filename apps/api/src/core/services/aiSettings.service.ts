import { nanoid } from 'nanoid'
import type { AiModelSourceType } from '@lucentdocs/shared'
import type { RepositorySet } from '../../core/ports/types.js'
import type { TransactionPort } from '../../core/ports/transaction.port.js'
import type { AiApiKeyEntity, AiProviderConfigEntity } from '../../core/ports/aiSettings.port.js'
import {
  isSameBaseURL,
  normalizeModelSourceType,
  normalizeProviderBaseURL,
  parseAndNormalizeHttpBaseURL,
} from '../ai/provider-types.js'

const DEFAULT_OPENAI_MODEL = 'gpt-5'

export interface AiProviderConfigRecord {
  id: string
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
  providers: AiProviderConfigRecord[]
  activeProviderId: string | null
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
  resolveRuntimeSelection(): Promise<RuntimeProviderSelection>
  resolveApiKeyForBaseURL(baseURL: string): Promise<string | null>
  resolveApiKeyById(id: string): Promise<string | null>
}

function normalizeModel(model: string): string {
  const trimmed = model.trim()
  return trimmed || DEFAULT_OPENAI_MODEL
}

function normalizeProviderId(type: AiModelSourceType, providerId: string): string {
  const trimmed = providerId.trim()
  if (trimmed) return trimmed
  if (type === 'anthropic') return 'anthropic'
  if (type === 'openrouter') return 'openrouter'
  return 'openai'
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
  async function getProviders(): Promise<AiProviderConfigEntity[]> {
    const providers = await repos.aiSettings.listProviderConfigs()
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

  return {
    async initializeDefaults(options?: { env?: NodeJS.ProcessEnv }): Promise<void> {
      const env = options?.env ?? process.env

      await transaction.run(async () => {
        const providers = await repos.aiSettings.listProviderConfigs()

        if (providers.length > 0) {
          const runtime = await repos.aiSettings.readRuntimeSettings()
          const runtimeIsValid = runtime?.activeProviderId
            ? providers.some((provider) => provider.id === runtime.activeProviderId)
            : false

          if (!runtimeIsValid) {
            await repos.aiSettings.upsertRuntimeSettings(providers[0]?.id ?? null, Date.now())
          }
          return
        }

        const now = Date.now()
        const envBaseURL = readTrimmedEnvValue(env, 'AI_BASE_URL') ?? ''
        const envModel = readTrimmedEnvValue(env, 'AI_MODEL') ?? ''
        const envProviderType =
          readTrimmedEnvValue(env, 'AI_PROVIDER_TYPE') ?? readTrimmedEnvValue(env, 'AI_PROVIDER')
        const type = envProviderType
          ? normalizeModelSourceType(envProviderType)
          : inferBootstrapProviderType(envBaseURL, envModel)
        const providerId = normalizeProviderId(
          type,
          readTrimmedEnvValue(env, 'AI_PROVIDER_ID') ?? ''
        )
        const baseURL = resolveProviderBaseURLOrThrow(type, envBaseURL)
        const model = normalizeModel(envModel)
        const apiKey = readTrimmedEnvValue(env, 'AI_API_KEY')
        const apiKeyName = readTrimmedEnvValue(env, 'AI_API_KEY_NAME')

        let apiKeyId: string | null = null
        if (apiKey) {
          apiKeyId = nanoid()
          await repos.aiSettings.insertApiKey({
            id: apiKeyId,
            baseURL,
            name: apiKeyName ?? 'Bootstrap key',
            apiKey,
            isDefault: true,
            createdAt: now,
            updatedAt: now,
          })
        }

        const providerConfigId = nanoid()
        await repos.aiSettings.upsertProviderConfig({
          id: providerConfigId,
          providerId,
          type,
          baseURL,
          model,
          apiKeyId,
          sortOrder: 0,
          createdAt: now,
          updatedAt: now,
        })
        await repos.aiSettings.upsertRuntimeSettings(providerConfigId, now)
      })
    },

    async getSnapshot(): Promise<AiSettingsSnapshot> {
      const providers = await getProviders()
      const runtime = await repos.aiSettings.readRuntimeSettings()
      const activeProviderId = selectActiveProviderId(providers, runtime?.activeProviderId ?? null)
      const apiKeys = await getApiKeys()

      return {
        providers: providers.map((provider) => ({
          id: provider.id,
          providerId: normalizeProviderId(provider.type, provider.providerId),
          type: normalizeModelSourceType(provider.type),
          baseURL: resolveProviderBaseURLOrThrow(provider.type, provider.baseURL),
          model: normalizeModel(provider.model),
          apiKeyId: provider.apiKeyId,
          sortOrder: provider.sortOrder,
        })),
        activeProviderId,
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

      const existingProviders = await repos.aiSettings.listProviderConfigs()
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
            throw new Error(`API key ${row.apiKeyId} was not found.`)
          }

          if (!isSameBaseURL(key.baseURL, row.baseURL)) {
            throw new Error(
              `API key ${row.apiKeyId} does not belong to provider base URL ${row.baseURL}.`
            )
          }
        }

        await repos.aiSettings.deleteProviderConfigsNotIn(nextRows.map((row) => row.id))
        for (const row of nextRows) {
          await repos.aiSettings.upsertProviderConfig(row)
        }

        const requestedActive = input.activeProviderId
        const activeProviderId = nextRows.some((row) => row.id === requestedActive)
          ? requestedActive
          : (nextRows[0]?.id ?? null)

        await repos.aiSettings.upsertRuntimeSettings(activeProviderId, now)
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
        throw new Error(`API key ${input.id} was not found.`)
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
        throw new Error(`API key ${id} was not found.`)
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

    async resolveRuntimeSelection(): Promise<RuntimeProviderSelection> {
      const snapshot = await this.getSnapshot()
      const active =
        snapshot.providers.find((provider) => provider.id === snapshot.activeProviderId) ??
        snapshot.providers[0]

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
