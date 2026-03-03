import { type LanguageModel } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { configManager, type ResolvedAiConfig } from '../config/manager.js'

export type AiConfig = ResolvedAiConfig

interface ResolvedProvider {
  model: LanguageModel
  config: AiConfig
}

let providerPromise: Promise<ResolvedProvider> | null = null

function getConfig(): AiConfig {
  return configManager.getConfig().ai
}

async function getProvider(): Promise<ResolvedProvider> {
  if (!providerPromise) {
    const config = getConfig()

    if (!config.apiKey) {
      throw new Error(
        `Missing API key: set AI_API_KEY in env or ${configManager.getConfig().paths.configFile}`
      )
    }

    providerPromise = Promise.resolve(
      config.provider === 'anthropic'
        ? {
            config,
            model: createAnthropic({
              apiKey: config.apiKey,
              baseURL: config.baseURL,
            })(config.model),
          }
        : config.provider === 'openai-compatible'
          ? {
              config,
              model: createOpenAICompatible({
                name: 'openai-compatible',
                apiKey: config.apiKey,
                baseURL: config.baseURL,
              })(config.model),
            }
          : {
              config,
              model: createOpenAI({
                apiKey: config.apiKey,
                baseURL: config.baseURL,
              })(config.model),
            }
    )
  }
  return providerPromise
}

export async function getLanguageModel(): Promise<LanguageModel> {
  const { model } = await getProvider()
  return model
}

/** Invalidate the client so the next call picks up updated config values. */
export function resetClient(): void {
  providerPromise = null
}
