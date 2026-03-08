import { createHash } from 'node:crypto'
import type { AiModelSourceType } from '@lucentdocs/shared'
import { AI_PROVIDER_DEFAULT_BASE_URLS, normalizeBaseURL } from '../core/ai/provider-types.js'

const MODELS_DEV_API_URL = 'https://models.dev/api.json'
const MODELS_DEV_LOGO_BASE_URL = 'https://models.dev/logos'
const MODELS_DEV_CACHE_TTL_MS = 10 * 60 * 1000
const PROVIDER_CACHE_TTL_MS = 10 * 60 * 1000
const PROVIDER_REQUEST_TIMEOUT_MS = 8_000
const OPENROUTER_MODELS_PATHS = ['/api/v1/models', '/api/frontend/models'] as const

export interface ModelCatalogModel {
  id: string
  name: string | null
  releaseDate: string | null
  contextLength?: number | null
  description?: string | null
}

export interface ModelCatalogProviderSummary {
  id: string
  name: string
  type: AiModelSourceType
  iconURL: string
  docURL: string | null
  apiBaseURL: string
}

export interface ModelCatalogProvider extends ModelCatalogProviderSummary {
  models: ModelCatalogModel[]
}

export interface SourceModelCatalogResult {
  provider: ModelCatalogProvider
  source: 'models.dev' | 'provider'
  warning: string | null
}

export type ModelCatalogUsage = 'generation' | 'embedding'

type ModelsDevCatalogById = Record<string, ModelCatalogProvider>

interface CachedModelsDevCatalog {
  expiresAt: number
  byId: ModelsDevCatalogById
  providers: ModelCatalogProviderSummary[]
}

let modelsDevCache: CachedModelsDevCatalog | null = null
let modelsDevInFlight: Promise<CachedModelsDevCatalog> | null = null

interface CachedProviderCatalog {
  expiresAt: number
  provider: ModelCatalogProvider
}

const providerCache = new Map<string, CachedProviderCatalog>()

class ProviderModelListUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderModelListUnavailableError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function inferProviderType(providerId: string, npmPackages: string[]): AiModelSourceType {
  if (providerId === 'anthropic') return 'anthropic'
  if (providerId === 'openrouter') return 'openrouter'
  if (npmPackages.some((entry) => entry.toLowerCase().includes('anthropic'))) {
    return 'anthropic'
  }
  return 'openai'
}

function resolveProviderBaseURL(type: AiModelSourceType, api: unknown): string {
  const defaultBaseURL = AI_PROVIDER_DEFAULT_BASE_URLS[type]
  if (typeof api !== 'string') return defaultBaseURL

  const trimmed = api.trim()
  if (!trimmed || trimmed.includes('${')) return defaultBaseURL

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return defaultBaseURL

    let pathname = parsed.pathname.replace(/\/+$/, '')
    if (pathname.endsWith('/chat/completions')) {
      pathname = pathname.slice(0, -'/chat/completions'.length)
    } else if (pathname.endsWith('/messages')) {
      pathname = pathname.slice(0, -'/messages'.length)
    }

    return `${parsed.origin}${pathname}`
  } catch {
    return defaultBaseURL
  }
}

function modelSupportsTextInputAndOutput(model: Record<string, unknown>): boolean {
  const modalities = isRecord(model.modalities) ? model.modalities : null
  if (!modalities) return false

  const input = toStringArray(modalities.input).map((entry) => entry.toLowerCase())
  const output = toStringArray(modalities.output).map((entry) => entry.toLowerCase())
  return input.includes('text') && output.includes('text')
}

function isLikelyEmbeddingModelId(modelId: string): boolean {
  const haystack = modelId.trim().toLowerCase()
  return haystack.includes('embedding') || haystack.includes('embed')
}

function normalizeModelEntries(models: Record<string, unknown>): ModelCatalogModel[] {
  const entries: ModelCatalogModel[] = []

  for (const [id, modelValue] of Object.entries(models)) {
    const model = isRecord(modelValue) ? modelValue : {}
    const isEmbeddingModel = isLikelyEmbeddingModelId(id)
    if (!isEmbeddingModel && !modelSupportsTextInputAndOutput(model)) continue

    const name = typeof model.name === 'string' ? model.name : null
    const releaseDate = typeof model.release_date === 'string' ? model.release_date : null
    const contextLength =
      typeof model.context_length === 'number' && Number.isFinite(model.context_length)
        ? model.context_length
        : null
    const description = typeof model.description === 'string' ? model.description : null

    entries.push({
      id,
      name,
      releaseDate,
      contextLength,
      description,
    })
  }

  return entries.sort((left, right) => left.id.localeCompare(right.id))
}

function parseModelsDevProvider(providerId: string, payload: unknown): ModelCatalogProvider {
  const provider = isRecord(payload) ? payload : {}
  const npmPackages = toStringArray(provider.npm)
  const type = inferProviderType(providerId, npmPackages)
  const name = typeof provider.name === 'string' ? provider.name : providerId
  const docURL = typeof provider.doc === 'string' ? provider.doc : null
  const models = isRecord(provider.models) ? normalizeModelEntries(provider.models) : []

  return {
    id: providerId,
    name,
    type,
    docURL,
    iconURL: `${MODELS_DEV_LOGO_BASE_URL}/${providerId}.svg`,
    apiBaseURL: resolveProviderBaseURL(type, provider.api),
    models,
  }
}

function toSummary(provider: ModelCatalogProvider): ModelCatalogProviderSummary {
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    iconURL: provider.iconURL,
    docURL: provider.docURL,
    apiBaseURL: provider.apiBaseURL,
  }
}

async function fetchModelsDevCatalog(): Promise<CachedModelsDevCatalog> {
  const response = await fetch(MODELS_DEV_API_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`models.dev request failed (${response.status})`)
  }

  const payload = (await response.json()) as unknown
  if (!isRecord(payload)) {
    throw new Error('models.dev response is not a JSON object')
  }

  const byId: ModelsDevCatalogById = {}
  for (const [providerId, providerPayload] of Object.entries(payload)) {
    byId[providerId] = parseModelsDevProvider(providerId, providerPayload)
  }

  const providers = Object.values(byId)
    .map(toSummary)
    .sort((left, right) => left.name.localeCompare(right.name))

  const data: CachedModelsDevCatalog = {
    expiresAt: Date.now() + MODELS_DEV_CACHE_TTL_MS,
    byId,
    providers,
  }
  modelsDevCache = data
  return data
}

async function getModelsDevCatalogData(forceRefresh = false): Promise<CachedModelsDevCatalog> {
  if (!forceRefresh && modelsDevCache && modelsDevCache.expiresAt > Date.now()) {
    return modelsDevCache
  }

  if (!modelsDevInFlight) {
    modelsDevInFlight = fetchModelsDevCatalog().finally(() => {
      modelsDevInFlight = null
    })
  }

  return modelsDevInFlight
}

async function tryGetModelsDevCatalogData(
  forceRefresh = false
): Promise<{ data: CachedModelsDevCatalog | null; error: string | null }> {
  try {
    const data = await getModelsDevCatalogData(forceRefresh)
    return { data, error: null }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function getModelsDevCatalog(
  forceRefresh = false
): Promise<ModelCatalogProviderSummary[]> {
  const data = await getModelsDevCatalogData(forceRefresh)
  return data.providers
}

function parseProviderModelArray(payload: unknown): ModelCatalogModel[] {
  if (!isRecord(payload)) {
    throw new ProviderModelListUnavailableError('provider response is not a JSON object')
  }

  const candidates = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : null
  if (!candidates) {
    throw new ProviderModelListUnavailableError('provider response does not include a model list')
  }

  const deduped = new Map<string, ModelCatalogModel>()

  for (const entry of candidates) {
    const idRaw =
      typeof entry === 'string'
        ? entry
        : isRecord(entry)
          ? typeof entry.id === 'string'
            ? entry.id
            : typeof entry.model === 'string'
              ? entry.model
              : null
          : null
    if (typeof idRaw !== 'string') continue
    const id = idRaw.trim()
    if (!id) continue

    const displayName =
      isRecord(entry) && typeof entry.display_name === 'string'
        ? entry.display_name
        : isRecord(entry) && typeof entry.name === 'string'
          ? entry.name
          : typeof entry === 'string'
            ? entry
            : null

    const releaseDate =
      isRecord(entry) && typeof entry.release_date === 'string'
        ? normalizeReleaseDate(entry.release_date)
        : isRecord(entry)
          ? normalizeReleaseDate(entry.created)
          : null
    const contextLength =
      isRecord(entry) &&
      typeof entry.context_length === 'number' &&
      Number.isFinite(entry.context_length)
        ? entry.context_length
        : isRecord(entry) &&
            typeof entry.context_window === 'number' &&
            Number.isFinite(entry.context_window)
          ? entry.context_window
          : null
    const description =
      isRecord(entry) && typeof entry.description === 'string' ? entry.description : null

    deduped.set(id, {
      id,
      name: displayName,
      releaseDate,
      contextLength,
      description,
    })
  }

  return [...deduped.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function normalizeReleaseDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value > 1_000_000_000_000 ? value : value * 1000
    const parsed = new Date(milliseconds)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10)
    }
    return null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)

    const parsed = new Date(trimmed)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10)
    }
  }

  return null
}

function isOpenRouterHost(baseURL: string): boolean {
  try {
    const parsed = new URL(baseURL)
    return parsed.hostname === 'openrouter.ai' || parsed.hostname.endsWith('.openrouter.ai')
  } catch {
    return false
  }
}

function fingerprintApiKey(apiKey: string): string {
  if (!apiKey) return 'anonymous'
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 16)
}

function buildEmbeddingsModelsEndpoint(baseURL: string): string {
  const normalized = baseURL.endsWith('/') ? baseURL : `${baseURL}/`
  return new URL('embeddings/models', normalized).toString()
}

function buildOpenRouterModelsEndpoints(baseURL: string): string[] {
  const normalized = baseURL.endsWith('/') ? baseURL : `${baseURL}/`
  const endpoints = [new URL('models', normalized).toString()]

  if (isOpenRouterHost(baseURL)) {
    const parsed = new URL(baseURL)
    for (const path of OPENROUTER_MODELS_PATHS) {
      endpoints.push(new URL(path, parsed.origin).toString())
    }
  }

  return [...new Set(endpoints)]
}

function parseOpenRouterModelArray(payload: unknown): ModelCatalogModel[] {
  if (!isRecord(payload)) {
    throw new ProviderModelListUnavailableError('openrouter response is not a JSON object')
  }

  const candidates = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : null

  if (!candidates) {
    throw new ProviderModelListUnavailableError('openrouter response does not include a model list')
  }

  const deduped = new Map<string, ModelCatalogModel>()

  for (const entry of candidates) {
    const idRaw =
      typeof entry === 'string'
        ? entry
        : isRecord(entry)
          ? typeof entry.id === 'string'
            ? entry.id
            : typeof entry.slug === 'string'
              ? entry.slug
              : typeof entry.model === 'string'
                ? entry.model
                : null
          : null
    if (typeof idRaw !== 'string') continue

    const id = idRaw.trim()
    if (!id) continue

    const name =
      isRecord(entry) && typeof entry.name === 'string'
        ? entry.name
        : isRecord(entry) && typeof entry.display_name === 'string'
          ? entry.display_name
          : typeof entry === 'string'
            ? entry
            : null

    const releaseDate =
      isRecord(entry) && typeof entry.release_date === 'string'
        ? normalizeReleaseDate(entry.release_date)
        : isRecord(entry)
          ? normalizeReleaseDate(entry.created)
          : null
    const contextLength =
      isRecord(entry) &&
      typeof entry.context_length === 'number' &&
      Number.isFinite(entry.context_length)
        ? entry.context_length
        : isRecord(entry) &&
            typeof entry.context_window === 'number' &&
            Number.isFinite(entry.context_window)
          ? entry.context_window
          : null
    const description =
      isRecord(entry) && typeof entry.description === 'string' ? entry.description : null

    deduped.set(id, {
      id,
      name,
      releaseDate,
      contextLength,
      description,
    })
  }

  return [...deduped.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function filterModelsForUsage(
  models: ModelCatalogModel[],
  usage: ModelCatalogUsage
): ModelCatalogModel[] {
  return models.filter((model) => {
    const isEmbedding = isLikelyEmbeddingModelId(model.id)
    if (usage === 'embedding') return isEmbedding

    const haystack = `${model.id} ${model.name ?? ''}`.toLowerCase()
    return !isEmbedding && !haystack.includes('image') && !haystack.includes('dall')
  })
}

function normalizeContextLength(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function parseEmbeddingModelsArray(payload: unknown): ModelCatalogModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new ProviderModelListUnavailableError('embedding models response is missing a data array')
  }

  const models: ModelCatalogModel[] = []
  for (const entry of payload.data) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue
    const id = entry.id.trim()
    if (!id) continue

    models.push({
      id,
      name: typeof entry.name === 'string' ? entry.name : null,
      releaseDate: null,
      contextLength: normalizeContextLength(entry.context_length),
      description: typeof entry.description === 'string' ? entry.description : null,
    })
  }

  return models.sort((left, right) => left.id.localeCompare(right.id))
}

function buildModelsEndpoint(baseURL: string): string {
  const normalized = baseURL.endsWith('/') ? baseURL : `${baseURL}/`
  return new URL('models', normalized).toString()
}

interface OpenRouterFetchResult {
  models: ModelCatalogModel[]
  embeddingFallbackWarning: string | null
}

async function fetchModelsFromOpenRouter(
  baseURL: string,
  apiKey: string,
  usage: ModelCatalogUsage
): Promise<OpenRouterFetchResult> {
  const headers: Record<string, string> = {
    accept: 'application/json',
  }
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`
  }

  if (usage === 'embedding') {
    const embeddingsEndpoint = buildEmbeddingsModelsEndpoint(baseURL)
    try {
      const response = await fetch(embeddingsEndpoint, {
        headers,
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
      })

      if (response.ok) {
        const payload = (await response.json()) as unknown
        const models = parseEmbeddingModelsArray(payload)
        return { models, embeddingFallbackWarning: null }
      }
    } catch {
      // Fall through to generic /models endpoint
    }
  }

  const endpoints = buildOpenRouterModelsEndpoints(baseURL)
  const failures: string[] = []
  let unavailableOnly = true

  for (const endpoint of endpoints) {
    let response: Response
    try {
      response = await fetch(endpoint, {
        headers,
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      unavailableOnly = false
      failures.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    if (!response.ok) {
      failures.push(`${endpoint}: ${response.status}`)
      if (response.status === 404 || response.status === 405 || response.status === 501) {
        continue
      }
      unavailableOnly = false
      continue
    }

    const payload = (await response.json()) as unknown
    const models = parseOpenRouterModelArray(payload)
    const embeddingFallbackWarning =
      usage === 'embedding'
        ? 'Live embedding catalog unavailable. Falling back to generic model list.'
        : null
    return { models, embeddingFallbackWarning }
  }

  const reason = failures.length > 0 ? `: ${failures.join('; ')}` : ''
  if (unavailableOnly) {
    throw new ProviderModelListUnavailableError(
      `openrouter endpoint does not expose a model list${reason}`
    )
  }

  throw new Error(`openrouter catalog request failed${reason}`)
}

interface ProviderFetchResult {
  models: ModelCatalogModel[]
  embeddingFallbackWarning: string | null
}

async function fetchModelsFromProvider(
  source: Pick<ModelCatalogProviderSummary, 'type' | 'apiBaseURL'>,
  apiKey: string,
  usage: ModelCatalogUsage
): Promise<ProviderFetchResult> {
  if (source.type === 'openrouter') {
    return fetchModelsFromOpenRouter(source.apiBaseURL, apiKey, usage)
  }

  const endpoint = buildModelsEndpoint(source.apiBaseURL)
  const headers: Record<string, string> = {
    accept: 'application/json',
  }

  if (source.type === 'anthropic') {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers.authorization = `Bearer ${apiKey}`
  }

  const response = await fetch(endpoint, {
    headers,
    signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    if (response.status === 404 || response.status === 405 || response.status === 501) {
      throw new ProviderModelListUnavailableError(
        `provider endpoint does not expose /models (${response.status})`
      )
    }
    throw new Error(`provider request failed (${response.status})`)
  }

  const payload = (await response.json()) as unknown
  return { models: parseProviderModelArray(payload), embeddingFallbackWarning: null }
}

function fallbackModelsDevProvider(
  providerId: string,
  type: AiModelSourceType,
  baseURL: string
): ModelCatalogProvider {
  return {
    id: providerId,
    name: providerId,
    type,
    docURL: null,
    iconURL: `${MODELS_DEV_LOGO_BASE_URL}/${providerId}.svg`,
    apiBaseURL: baseURL || AI_PROVIDER_DEFAULT_BASE_URLS[type],
    models: [],
  }
}

/**
 * Prefer the live provider catalog when credentials allow it, then fall back to
 * models.dev metadata when the provider does not expose a compatible listing or
 * the provider request fails.
 */
export async function getSourceModelCatalog(
  source: {
    providerId: string
    type: AiModelSourceType
    baseURL: string
  },
  apiKey: string,
  usage: ModelCatalogUsage,
  options: { forceRefresh?: boolean } = {}
): Promise<SourceModelCatalogResult> {
  const modelsDev = await tryGetModelsDevCatalogData(options.forceRefresh === true)
  const baseURL = normalizeBaseURL(source.baseURL) || AI_PROVIDER_DEFAULT_BASE_URLS[source.type]
  const modelsDevProviderRaw =
    modelsDev.data?.byId[source.providerId] ??
    fallbackModelsDevProvider(source.providerId, source.type, baseURL)
  const modelsDevProvider = {
    ...modelsDevProviderRaw,
    models: filterModelsForUsage(modelsDevProviderRaw.models, usage),
  }

  const shouldQueryProvider = Boolean(apiKey) || source.type === 'openrouter'
  if (!shouldQueryProvider) {
    return {
      provider: modelsDevProvider,
      source: 'models.dev',
      warning: modelsDev.error ? `models.dev catalog unavailable: ${modelsDev.error}` : null,
    }
  }

  const cacheKey = `${source.providerId}|${source.type}|${baseURL}|${usage}|${fingerprintApiKey(apiKey)}`
  const cached = providerCache.get(cacheKey)

  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return {
      provider: cached.provider,
      source: 'provider',
      warning: null,
    }
  }

  try {
    const fetchResult = await fetchModelsFromProvider(
      {
        type: source.type,
        apiBaseURL: baseURL,
      },
      apiKey,
      usage
    )

    const result: ModelCatalogProvider = {
      ...modelsDevProvider,
      type: source.type,
      apiBaseURL: baseURL,
      models: filterModelsForUsage(fetchResult.models, usage),
    }

    providerCache.set(cacheKey, {
      expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS,
      provider: result,
    })

    return {
      provider: result,
      source: 'provider',
      warning: fetchResult.embeddingFallbackWarning,
    }
  } catch (error) {
    if (error instanceof ProviderModelListUnavailableError) {
      return {
        provider: {
          ...modelsDevProvider,
          type: source.type,
          apiBaseURL: baseURL,
        },
        source: 'models.dev',
        warning: modelsDev.error
          ? `Provider does not expose a model list and models.dev is unavailable: ${modelsDev.error}`
          : null,
      }
    }

    const providerReason = error instanceof Error ? error.message : String(error)
    const modelsDevReason = modelsDev.error
    const warning = modelsDevReason
      ? `Provider catalog failed (${providerReason}). models.dev fallback unavailable: ${modelsDevReason}`
      : `Falling back to models.dev catalog: ${providerReason}`

    return {
      provider: {
        ...modelsDevProvider,
        type: source.type,
        apiBaseURL: baseURL,
      },
      source: 'models.dev',
      warning,
    }
  }
}
