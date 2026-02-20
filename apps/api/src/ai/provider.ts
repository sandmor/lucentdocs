import { generateText, streamText, type LanguageModel } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

export interface AiConfig {
  provider: 'openai' | 'anthropic' | 'openai-compatible'
  baseURL: string
  apiKey: string
  model: string
}

interface ResolvedProvider {
  model: LanguageModel
  config: AiConfig
}

let providerPromise: Promise<ResolvedProvider> | null = null

function getBaseURL(): string {
  return process.env.AI_BASE_URL || ''
}

function guessProviderFromDomain(baseURL: string, model: string): AiConfig['provider'] {
  let hostname = ''
  if (baseURL) {
    try {
      hostname = new URL(baseURL).hostname.toLowerCase()
    } catch {
      hostname = ''
    }
  }

  if (hostname.includes('anthropic')) return 'anthropic'
  if (hostname.includes('openai')) return 'openai'

  if (model.toLowerCase().startsWith('claude')) return 'anthropic'
  if (!baseURL) return 'openai'

  return 'openai-compatible'
}

function getConfig(): AiConfig {
  const baseURL = getBaseURL()
  const defaultModel = process.env.AI_MODEL || 'gpt-4o-mini'
  const provider = guessProviderFromDomain(baseURL, defaultModel)
  const apiKey = process.env.AI_API_KEY || ''

  if (provider === 'anthropic') {
    return {
      provider,
      baseURL: baseURL || 'https://api.anthropic.com/v1',
      apiKey,
      model: process.env.AI_MODEL || 'claude-3-5-haiku-latest',
    }
  }

  return {
    provider,
    baseURL: baseURL || 'https://api.openai.com/v1',
    apiKey,
    model: defaultModel,
  }
}

async function getProvider(): Promise<ResolvedProvider> {
  if (!providerPromise) {
    const config = getConfig()

    if (!config.apiKey) {
      throw new Error('Missing API key: set AI_API_KEY')
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

/** Invalidate the client so the next call picks up new env vars. */
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
    maxOutputTokens: options.maxOutputTokens ?? 1024,
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
    maxOutputTokens: options.maxOutputTokens ?? 1024,
    temperature: options.temperature ?? 0.8,
    abortSignal: options.abortSignal,
  })
}
