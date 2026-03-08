import { type LanguageModel } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { AiModelSourceType } from '@lucentdocs/shared'
import type { AiSettingsService } from '../core/services/aiSettings.service.js'
import { AI_PROVIDER_DEFAULT_BASE_URLS, normalizeBaseURL } from '../core/ai/provider-types.js'

export interface AiConfig {
  provider: 'openai' | 'anthropic' | 'openai-compatible' | 'openrouter'
  source: {
    type: AiModelSourceType
    baseURL: string
    model: string
  }
  apiKey: string
}

interface ResolvedProvider {
  model: LanguageModel
  config: AiConfig
}

// Cached across requests until configuration changes, so repeated generations do
// not rebuild SDK clients on every call.
let providerPromise: Promise<ResolvedProvider> | null = null
let aiSettingsService: AiSettingsService | null = null

export function configureAiProvider(service: AiSettingsService): void {
  aiSettingsService = service
  resetClient()
}

function getAiSettingsService(): AiSettingsService {
  if (!aiSettingsService) {
    throw new Error('AI settings service is not configured.')
  }
  return aiSettingsService
}

async function resolveRuntimeConfig(): Promise<AiConfig> {
  const selection = await getAiSettingsService().resolveRuntimeSelection('generation')
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
    source: {
      type: selection.type,
      baseURL: selection.baseURL,
      model: selection.model,
    },
  }
}

async function getProvider(): Promise<ResolvedProvider> {
  if (!providerPromise) {
    const config = await resolveRuntimeConfig()

    const source = config.source
    const requiresApiKey = config.provider !== 'openai-compatible'
    if (requiresApiKey && !config.apiKey) {
      throw new Error('Missing API key for the active provider configuration.')
    }

    providerPromise = Promise.resolve(
      config.provider === 'anthropic'
        ? {
            config,
            model: createAnthropic({
              apiKey: config.apiKey,
              baseURL: source.baseURL,
            })(source.model),
          }
        : config.provider === 'openrouter'
          ? {
              config,
              model: createOpenAICompatible({
                name: 'openrouter',
                apiKey: config.apiKey,
                baseURL: source.baseURL,
              })(source.model),
            }
          : config.provider === 'openai-compatible'
            ? {
                config,
                model: createOpenAICompatible({
                  name: 'openai-compatible',
                  ...(config.apiKey ? { apiKey: config.apiKey } : {}),
                  baseURL: source.baseURL,
                })(source.model),
              }
            : {
                config,
                model: createOpenAI({
                  apiKey: config.apiKey,
                  baseURL: source.baseURL,
                })(source.model),
              }
    )
  }
  return providerPromise!
}

export async function getLanguageModel(): Promise<LanguageModel> {
  const { model } = await getProvider()
  return model
}

/** Invalidate the client so the next call picks up updated config values. */
export function resetClient(): void {
  providerPromise = null
}
