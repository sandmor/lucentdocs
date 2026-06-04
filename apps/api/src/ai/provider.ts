import { type LanguageModel } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { AiModelSourceType } from '@lucentdocs/shared'
import type { AiProviderCustomHeaders } from '@lucentdocs/shared'
import { fingerprintCustomHeaders } from '@lucentdocs/shared'
import type { AiSettingsService } from '../core/services/aiSettings.service.js'
import type { AiModelSelectionService } from '../core/services/aiModelSelection.service.js'
import { AI_PROVIDER_DEFAULT_BASE_URLS, normalizeBaseURL } from '../core/ai/provider-types.js'

export interface AiConfig {
  provider: 'openai' | 'anthropic' | 'openai-compatible' | 'openrouter'
  source: {
    type: AiModelSourceType
    baseURL: string
    model: string
  }
  apiKey: string
  customHeaders: AiProviderCustomHeaders
}

interface ResolvedProvider {
  model: LanguageModel
  config: AiConfig
}

export interface AiModelRuntimeScope {
  documentId?: string
  projectId?: string
}

interface RuntimeProviderSelection {
  providerConfigId: string
  providerId: string
  type: AiModelSourceType
  baseURL: string
  model: string
  apiKey: string
  customHeaders: AiProviderCustomHeaders
}

// Cached across requests until configuration changes, so repeated generations do
// not rebuild SDK clients on every call.
const providerPromises = new Map<string, Promise<ResolvedProvider>>()
let aiSettingsService: AiSettingsService | null = null
let aiModelSelectionService: AiModelSelectionService | null = null

export function configureAiProvider(service: AiSettingsService): void {
  aiSettingsService = service
  resetClient()
}

export function configureAiModelSelection(service: AiModelSelectionService): void {
  aiModelSelectionService = service
  resetClient()
}

function getAiSettingsService(): AiSettingsService {
  if (!aiSettingsService) {
    throw new Error('AI settings service is not configured.')
  }
  return aiSettingsService
}

function getAiModelSelectionService(): AiModelSelectionService {
  if (!aiModelSelectionService) {
    throw new Error('AI model selection service is not configured.')
  }
  return aiModelSelectionService
}

function toAiConfig(selection: RuntimeProviderSelection): AiConfig {
  const openaiDefault = normalizeBaseURL(AI_PROVIDER_DEFAULT_BASE_URLS.openai)
  const sourceBaseURL = normalizeBaseURL(selection.baseURL)

  const provider =
    selection.type === 'anthropic'
      ? 'anthropic'
      : selection.type === 'openrouter'
        ? 'openrouter'
        : sourceBaseURL === openaiDefault
          ? 'openai'
          : 'openai-compatible'

  return {
    provider,
    apiKey: selection.apiKey,
    customHeaders: selection.customHeaders,
    source: {
      type: selection.type,
      baseURL: selection.baseURL,
      model: selection.model,
    },
  }
}

async function resolveConfiguredProviderById(
  providerConfigId: string
): Promise<RuntimeProviderSelection> {
  const provider = await getAiSettingsService().resolveProviderByConfigId(providerConfigId)
  if (!provider) {
    throw new Error(`Resolved provider config ${providerConfigId} is no longer available.`)
  }
  return provider
}

async function resolveProviderSelection(
  scope?: AiModelRuntimeScope
): Promise<RuntimeProviderSelection> {
  if (scope?.documentId) {
    const resolved = await getAiModelSelectionService().resolveForDocument(
      scope.documentId,
      scope.projectId
    )
    if (!resolved) {
      throw new Error(`Failed to resolve AI model selection for document ${scope.documentId}.`)
    }
    return resolveConfiguredProviderById(resolved.providerConfigId)
  }

  if (scope?.projectId) {
    const resolved = await getAiModelSelectionService().resolveForProject(scope.projectId)
    if (!resolved) {
      throw new Error(`Failed to resolve AI model selection for project ${scope.projectId}.`)
    }
    return resolveConfiguredProviderById(resolved.providerConfigId)
  }

  const global = await getAiModelSelectionService().getGlobal()
  return resolveConfiguredProviderById(global.providerConfigId)
}

function buildProviderCacheKey(config: AiConfig, providerConfigId: string): string {
  return [
    providerConfigId,
    config.provider,
    config.source.type,
    config.source.baseURL,
    config.source.model,
    fingerprintCustomHeaders(config.customHeaders),
  ].join('|')
}

function providerClientOptions(config: AiConfig): {
  apiKey?: string
  baseURL: string
  headers?: Record<string, string>
} {
  const options = {
    baseURL: config.source.baseURL,
    ...(Object.keys(config.customHeaders).length > 0 ? { headers: config.customHeaders } : {}),
  }

  if (config.provider === 'openai-compatible' && !config.apiKey) {
    return options
  }

  return {
    ...options,
    apiKey: config.apiKey,
  }
}

async function resolveProviderConfig(scope?: AiModelRuntimeScope): Promise<{
  providerConfigId: string
  config: AiConfig
}> {
  const selection = await resolveProviderSelection(scope)
  return { providerConfigId: selection.providerConfigId, config: toAiConfig(selection) }
}

async function getProvider(scope?: AiModelRuntimeScope): Promise<ResolvedProvider> {
  const { providerConfigId, config } = await resolveProviderConfig(scope)
  const cacheKey = buildProviderCacheKey(config, providerConfigId)

  const cached = providerPromises.get(cacheKey)
  if (cached) {
    return cached
  }

  const source = config.source
  const requiresApiKey = config.provider !== 'openai-compatible'
  if (requiresApiKey && !config.apiKey) {
    throw new Error('Missing API key for the active provider configuration.')
  }

  const clientOptions = providerClientOptions(config)

  const created = Promise.resolve(
    config.provider === 'anthropic'
      ? {
          config,
          model: createAnthropic(clientOptions)(source.model),
        }
      : config.provider === 'openrouter'
        ? {
            config,
            model: createOpenAICompatible({
              name: 'openrouter',
              ...clientOptions,
            })(source.model),
          }
        : config.provider === 'openai-compatible'
          ? {
              config,
              model: createOpenAICompatible({
                name: 'openai-compatible',
                ...clientOptions,
              })(source.model),
            }
          : {
              config,
              model: createOpenAI(clientOptions)(source.model),
            }
  ).catch((error) => {
    providerPromises.delete(cacheKey)
    throw error
  })

  providerPromises.set(cacheKey, created)
  return created
}

export async function getLanguageModel(scope?: AiModelRuntimeScope): Promise<LanguageModel> {
  const { model } = await getProvider(scope)
  return model
}

/** Invalidate the client so the next call picks up updated config values. */
export function resetClient(): void {
  providerPromises.clear()
}
