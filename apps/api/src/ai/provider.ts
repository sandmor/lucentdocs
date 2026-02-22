import { generateText, streamText, type LanguageModel } from 'ai'
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
      throw new Error(`Missing API key: set AI_API_KEY in env or ${configManager.getConfig().paths.configFile}`)
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

/** Invalidate the client so the next call picks up updated config values. */
export function resetClient(): void {
  providerPromise = null
}

export interface GenerateOptions {
  /** System prompt setting the writing context */
  systemPrompt: string
  /** The actual user prompt / context */
  userPrompt: string
  /** Max completion tokens to generate */
  maxOutputTokens?: number
  /** Temperature (0-2) */
  temperature?: number
  /** Optional abort signal */
  abortSignal?: AbortSignal
}

/**
 * Generate text using the configured OpenAI-compatible endpoint.
 * Works with Ollama, llama.cpp, OpenAI, or any compatible API.
 */
export async function generate(options: GenerateOptions): Promise<string> {
  const { model } = await getProvider()
  const response = await generateText({
    model,
    system: options.systemPrompt,
    prompt: options.userPrompt,
    maxOutputTokens: options.maxOutputTokens,
    temperature: options.temperature ?? 0.8,
    abortSignal: options.abortSignal,
  })

  return response.text
}

/**
 * Stream text generation. Returns an async iterable of text chunks.
 */
export async function generateStream(options: GenerateOptions) {
  const { model } = await getProvider()

  return streamText({
    model,
    system: options.systemPrompt,
    prompt: options.userPrompt,
    maxOutputTokens: options.maxOutputTokens,
    temperature: options.temperature ?? 0.8,
    abortSignal: options.abortSignal,
  })
}
