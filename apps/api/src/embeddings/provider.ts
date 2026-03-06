import type { AiModelSourceType } from '@lucentdocs/shared'
import type { AiSettingsService } from '../core/services/aiSettings.service.js'
import { AI_PROVIDER_DEFAULT_BASE_URLS, normalizeBaseURL } from '../core/ai/provider-types.js'

const PROVIDER_REQUEST_TIMEOUT_MS = 30_000
const MAX_EMBEDDING_DIMENSIONS = 8192

export interface EmbeddingConfig {
  provider: 'openai' | 'openai-compatible' | 'openrouter'
  apiKey: string
  source: {
    providerConfigId: string
    providerId: string
    type: AiModelSourceType
    baseURL: string
    model: string
  }
}

export interface EmbeddingResult {
  index: number
  embedding: number[]
}

export interface EmbeddingProvider {
  config: EmbeddingConfig
  embed(inputs: string[]): Promise<EmbeddingResult[]>
}

let providerPromise: Promise<EmbeddingProvider> | null = null
let aiSettingsService: AiSettingsService | null = null

export function configureEmbeddingProvider(service: AiSettingsService): void {
  aiSettingsService = service
  resetEmbeddingClient()
}

function getAiSettingsService(): AiSettingsService {
  if (!aiSettingsService) {
    throw new Error('Embedding provider is not configured.')
  }
  return aiSettingsService
}

async function resolveRuntimeConfig(): Promise<EmbeddingConfig> {
  const selection = await getAiSettingsService().resolveRuntimeSelection('embedding')
  const openaiDefault = normalizeBaseURL(AI_PROVIDER_DEFAULT_BASE_URLS.openai)
  const sourceBaseURL = normalizeBaseURL(selection.baseURL)

  if (selection.type === 'anthropic') {
    throw new Error('Anthropic does not currently expose an embeddings API in this app.')
  }

  const provider =
    selection.type === 'openrouter'
      ? 'openrouter'
      : sourceBaseURL === openaiDefault
        ? 'openai'
        : 'openai-compatible'

  return {
    provider,
    apiKey: selection.apiKey,
    source: {
      providerConfigId: selection.providerConfigId,
      providerId: selection.providerId,
      type: selection.type,
      baseURL: selection.baseURL,
      model: selection.model,
    },
  }
}

function buildEmbeddingsEndpoint(baseURL: string): string {
  const normalized = baseURL.endsWith('/') ? baseURL : `${baseURL}/`
  return new URL('embeddings', normalized).toString()
}

function extractEmbeddingArray(payload: unknown): EmbeddingResult[] {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !Array.isArray((payload as { data?: unknown }).data)
  ) {
    throw new Error('Embedding response is missing a data array.')
  }

  const results: EmbeddingResult[] = []

  for (const [index, item] of (payload as { data: unknown[] }).data.entries()) {
    if (
      typeof item !== 'object' ||
      item === null ||
      !Array.isArray((item as { embedding?: unknown }).embedding)
    ) {
      throw new Error(`Embedding response entry ${index} is invalid.`)
    }

    const embedding = (item as { embedding: unknown[] }).embedding.map((value, valueIndex) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Embedding value ${valueIndex} for entry ${index} is invalid.`)
      }
      return value
    })

    if (embedding.length === 0) {
      throw new Error(`Embedding response entry ${index} is empty.`)
    }

    if (embedding.length > MAX_EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding response entry ${index} exceeds the maximum supported dimension count (${MAX_EMBEDDING_DIMENSIONS}).`
      )
    }

    results.push({ index, embedding })
  }

  return results
}

function validateEmbeddingBatch(embeddings: EmbeddingResult[]): void {
  if (embeddings.length === 0) {
    throw new Error('Embedding response did not include any vectors.')
  }

  const expectedDimensions = embeddings[0]?.embedding.length ?? 0
  if (expectedDimensions <= 0) {
    throw new Error('Embedding response contained an empty vector.')
  }

  for (const [index, item] of embeddings.entries()) {
    if (item.embedding.length !== expectedDimensions) {
      throw new Error(
        `Embedding response entry ${index} has ${item.embedding.length} dimensions, expected ${expectedDimensions}.`
      )
    }
  }
}

async function createProvider(): Promise<EmbeddingProvider> {
  const config = await resolveRuntimeConfig()
  const requiresApiKey = config.provider !== 'openai-compatible'
  if (requiresApiKey && !config.apiKey) {
    throw new Error('Missing API key for the active embedding provider configuration.')
  }

  return {
    config,
    async embed(inputs: string[]): Promise<EmbeddingResult[]> {
      if (inputs.length === 0) return []

      const response = await fetch(buildEmbeddingsEndpoint(config.source.baseURL), {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.source.model,
          input: inputs,
        }),
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(
          `Embedding request failed (${response.status})${text ? `: ${text.slice(0, 400)}` : ''}`
        )
      }

      const payload = (await response.json()) as unknown
      const embeddings = extractEmbeddingArray(payload)
      if (embeddings.length !== inputs.length) {
        throw new Error(
          `Embedding response length mismatch. Expected ${inputs.length}, received ${embeddings.length}.`
        )
      }
      validateEmbeddingBatch(embeddings)
      return embeddings
    },
  }
}

export async function getEmbeddingProvider(): Promise<EmbeddingProvider> {
  if (!providerPromise) {
    providerPromise = createProvider().catch((error) => {
      providerPromise = null
      throw error
    })
  }
  return providerPromise
}

export function resetEmbeddingClient(): void {
  providerPromise = null
}
