import type { AiModelSourceType } from '@plotline/shared'
import { AI_PROVIDER_DEFAULT_BASE_URLS, normalizeBaseURL } from '../core/ai/provider-types.js'

const MODELS_DEV_API_URL = 'https://models.dev/api.json'
const MODELS_DEV_LOGO_BASE_URL = 'https://models.dev/logos'
const MODELS_DEV_CACHE_TTL_MS = 10 * 60 * 1000
const PROVIDER_REQUEST_TIMEOUT_MS = 8_000

export interface ModelCatalogModel {
  id: string
  name: string | null
  releaseDate: string | null
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

type ModelsDevCatalogById = Record<string, ModelCatalogProvider>

interface CachedModelsDevCatalog {
  expiresAt: number
  byId: ModelsDevCatalogById
  providers: ModelCatalogProviderSummary[]
}

let modelsDevCache: CachedModelsDevCatalog | null = null
let modelsDevInFlight: Promise<CachedModelsDevCatalog> | null = null

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

function shouldExcludeModel(modelId: string, model: Record<string, unknown>): boolean {
  const name = typeof model.name === 'string' ? model.name : ''
  const family = typeof model.family === 'string' ? model.family : ''
  const haystack = `${modelId} ${name} ${family}`.toLowerCase()

  return (
    haystack.includes('embedding') ||
    haystack.includes('embed') ||
    haystack.includes('image') ||
    haystack.includes('dall')
  )
}

function normalizeModelEntries(models: Record<string, unknown>): ModelCatalogModel[] {
  const entries: ModelCatalogModel[] = []

  for (const [id, modelValue] of Object.entries(models)) {
    const model = isRecord(modelValue) ? modelValue : {}
    if (!modelSupportsTextInputAndOutput(model)) continue
    if (shouldExcludeModel(id, model)) continue

    const name = typeof model.name === 'string' ? model.name : null
    const releaseDate = typeof model.release_date === 'string' ? model.release_date : null

    entries.push({
      id,
      name,
      releaseDate,
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

    let releaseDate: string | null = null
    if (isRecord(entry) && typeof entry.release_date === 'string') {
      releaseDate = entry.release_date
    } else if (
      isRecord(entry) &&
      typeof entry.created === 'number' &&
      Number.isFinite(entry.created)
    ) {
      releaseDate = new Date(entry.created * 1000).toISOString().slice(0, 10)
    }

    deduped.set(id, {
      id,
      name: displayName,
      releaseDate,
    })
  }

  return [...deduped.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function buildModelsEndpoint(baseURL: string): string {
  const normalized = baseURL.endsWith('/') ? baseURL : `${baseURL}/`
  return new URL('models', normalized).toString()
}

async function fetchModelsFromProvider(
  source: Pick<ModelCatalogProviderSummary, 'type' | 'apiBaseURL'>,
  apiKey: string
): Promise<ModelCatalogModel[]> {
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
  return parseProviderModelArray(payload)
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

export async function getSourceModelCatalog(
  source: {
    providerId: string
    type: AiModelSourceType
    baseURL: string
  },
  apiKey: string,
  options: { forceRefresh?: boolean } = {}
): Promise<SourceModelCatalogResult> {
  const modelsDev = await tryGetModelsDevCatalogData(options.forceRefresh === true)
  const baseURL = normalizeBaseURL(source.baseURL) || AI_PROVIDER_DEFAULT_BASE_URLS[source.type]
  const modelsDevProvider =
    modelsDev.data?.byId[source.providerId] ??
    fallbackModelsDevProvider(source.providerId, source.type, baseURL)

  if (!apiKey) {
    return {
      provider: modelsDevProvider,
      source: 'models.dev',
      warning: modelsDev.error ? `models.dev catalog unavailable: ${modelsDev.error}` : null,
    }
  }

  try {
    const providerModels = await fetchModelsFromProvider(
      {
        type: source.type,
        apiBaseURL: baseURL,
      },
      apiKey
    )

    return {
      provider: {
        ...modelsDevProvider,
        type: source.type,
        apiBaseURL: baseURL,
        models: providerModels,
      },
      source: 'provider',
      warning: null,
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
