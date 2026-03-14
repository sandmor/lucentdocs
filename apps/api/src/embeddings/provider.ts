import type { AiModelSourceType } from '@lucentdocs/shared'
import type { AiSettingsService } from '../core/services/aiSettings.service.js'
import { AI_PROVIDER_DEFAULT_BASE_URLS, normalizeBaseURL } from '../core/ai/provider-types.js'

const PROVIDER_REQUEST_TIMEOUT_MS = 30_000
const MAX_EMBEDDING_DIMENSIONS = 8192
const TEST_FAKE_EMBEDDINGS_ENV = 'LUCENTDOCS_TEST_FAKE_EMBEDDINGS'

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

export interface EmbeddingProviderRuntimeOptions {
  fetchImpl?: typeof fetch
}

function shouldUseFakeEmbeddings(): boolean {
  return process.env[TEST_FAKE_EMBEDDINGS_ENV] === '1'
}

function tokenizeEmbeddingInput(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
}

function hashToken(token: string): number {
  let hash = 2166136261
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function buildFakeEmbedding(input: string): number[] {
  const dimensions = 32
  const vector = new Array<number>(dimensions).fill(0)
  const tokens = tokenizeEmbeddingInput(input)

  if (tokens.length === 0) {
    vector[0] = 1
    return vector
  }

  for (const token of tokens) {
    const hash = hashToken(token)
    const index = hash % dimensions
    const sign = hash % 2 === 0 ? 1 : -1
    vector[index] += sign * (1 + (token.length % 3) * 0.25)
  }

  const magnitude = Math.hypot(...vector)
  if (magnitude === 0) {
    vector[0] = 1
    return vector
  }

  return vector.map((value) => value / magnitude)
}

function buildFakeEmbeddingBatch(inputs: string[]): EmbeddingResult[] {
  return inputs.map((input, index) => ({
    index,
    embedding: buildFakeEmbedding(input),
  }))
}

let providerPromise: Promise<EmbeddingProvider> | null = null
let aiSettingsService: AiSettingsService | null = null
let embeddingFetchOverride: typeof fetch | null = null

export function configureEmbeddingProvider(
  service: AiSettingsService,
  options: EmbeddingProviderRuntimeOptions = {}
): void {
  resetEmbeddingClient()
  aiSettingsService = service
  embeddingFetchOverride = options.fetchImpl ?? null
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
  if (shouldUseFakeEmbeddings()) {
    return {
      config,
      async embed(inputs: string[]): Promise<EmbeddingResult[]> {
        return buildFakeEmbeddingBatch(inputs)
      },
    }
  }

  const requiresApiKey = config.provider !== 'openai-compatible'
  if (requiresApiKey && !config.apiKey) {
    throw new Error('Missing API key for the active embedding provider configuration.')
  }

  return {
    config,
    async embed(inputs: string[]): Promise<EmbeddingResult[]> {
      if (inputs.length === 0) return []

      const fetchImpl = embeddingFetchOverride ?? globalThis.fetch
      const response = await fetchImpl(buildEmbeddingsEndpoint(config.source.baseURL), {
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

      const raw = await response.text().catch(() => '')
      if (!raw) {
        throw new Error('Embedding response body was empty.')
      }

      let payload: unknown
      try {
        payload = JSON.parse(raw) as unknown
      } catch (error) {
        const contentType = response.headers.get('content-type') ?? 'unknown'
        throw new Error(
          `Embedding response was not valid JSON (content-type: ${contentType}): ${raw.slice(0, 400)}`
        )
      }
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
  embeddingFetchOverride = null
}
