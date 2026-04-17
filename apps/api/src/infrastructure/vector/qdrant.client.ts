import { createHash } from 'node:crypto'
import { qdrantCollectionName } from '../../core/embeddings/documentEmbeddings.shared.js'

export interface QdrantSearchPoint {
  id: number | string
  score?: number
  payload?: {
    vectorKey?: string
    documentId?: string
    baseUrl?: string
    model?: string
  }
}

export interface QdrantSearchResponse {
  result?: QdrantSearchPoint[]
}

export interface QdrantRetrievePoint {
  id: number | string
}

export interface QdrantRetrieveResponse {
  result?: QdrantRetrievePoint[]
}

export interface QdrantConfig {
  endpoint: string
  apiKey?: string
  collectionPrefix: string
  upsertBatchSize?: number
  upsertBatchConcurrency?: number
  fetchImpl?: typeof fetch
}

export function qdrantPointId(vectorKey: string): string {
  const hex = createHash('sha256').update(vectorKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export class QdrantClient {
  private readonly endpoint: string
  private readonly apiKey?: string
  public readonly collectionPrefix: string
  private readonly upsertBatchSize: number
  private readonly upsertBatchConcurrency: number
  private readonly fetchImpl: typeof fetch
  private readonly knownCollections = new Set<string>()

  constructor(config: QdrantConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, '')
    this.apiKey = config.apiKey
    this.collectionPrefix = config.collectionPrefix
    this.upsertBatchSize = Math.max(1, config.upsertBatchSize ?? 64)
    this.upsertBatchConcurrency = Math.max(1, config.upsertBatchConcurrency ?? 2)
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers ?? undefined)
    if (!headers.has('content-type') && init.body !== undefined) {
      headers.set('content-type', 'application/json')
    }
    if (this.apiKey) {
      headers.set('api-key', this.apiKey)
    }

    return this.fetchImpl(`${this.endpoint}${path}`, {
      ...init,
      headers,
    })
  }

  collectionName(dimensions: number, baseURL: string, model: string): string {
    return qdrantCollectionName(dimensions, this.collectionPrefix, baseURL, model)
  }

  async ensureCollection(dimensions: number, baseURL: string, model: string): Promise<string> {
    const collection = this.collectionName(dimensions, baseURL, model)
    if (this.knownCollections.has(collection)) return collection

    const check = await this.request(`/collections/${collection}`, { method: 'GET' })
    if (check.status === 404) {
      const create = await this.request(`/collections/${collection}`, {
        method: 'PUT',
        body: JSON.stringify({
          vectors: {
            size: dimensions,
            distance: 'Cosine',
          },
        }),
      })
      if (!create.ok) {
        throw new Error(`Failed to create Qdrant collection ${collection}: HTTP ${create.status}`)
      }
    } else if (!check.ok) {
      throw new Error(`Failed to check Qdrant collection ${collection}: HTTP ${check.status}`)
    }

    await this.ensurePayloadIndex(collection, 'projectIds', { type: 'keyword' })
    await this.ensurePayloadIndex(collection, 'baseUrl', { type: 'keyword' })
    await this.ensurePayloadIndex(collection, 'model', { type: 'keyword' })
    await this.ensurePayloadIndex(collection, 'documentId', { type: 'keyword' })
    await this.ensurePayloadIndex(collection, 'parentDirectory', { type: 'keyword' })
    await this.ensurePayloadIndex(collection, 'directoryAncestors', { type: 'keyword' })

    this.knownCollections.add(collection)
    return collection
  }

  private async ensurePayloadIndex(
    collection: string,
    fieldName: string,
    schema: { type: string; is_tenant?: boolean }
  ): Promise<void> {
    const response = await this.request(`/collections/${collection}/index`, {
      method: 'PUT',
      body: JSON.stringify({
        field_name: fieldName,
        field_schema: schema,
      }),
    })
    if (!response.ok) {
      throw new Error(
        `Failed to create index for ${fieldName} on Qdrant collection ${collection}: HTTP ${response.status}`
      )
    }
  }

  private async upsertPointBatch(
    collection: string,
    points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>
  ): Promise<void> {
    if (points.length === 0) return

    const response = await this.request(`/collections/${collection}/points?wait=true`, {
      method: 'PUT',
      body: JSON.stringify({ points }),
    })

    if (!response.ok) {
      throw new Error(
        `Failed to upsert points into Qdrant collection ${collection}: HTTP ${response.status}`
      )
    }
  }

  async upsertPoints(
    collection: string,
    points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>
  ): Promise<void> {
    if (points.length === 0) return

    const batches: Array<
      Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>
    > = []
    for (let i = 0; i < points.length; i += this.upsertBatchSize) {
      batches.push(points.slice(i, i + this.upsertBatchSize))
    }

    const workerCount = Math.max(1, Math.min(this.upsertBatchConcurrency, batches.length))
    let nextBatchIndex = 0
    const runWorker = async (): Promise<void> => {
      while (true) {
        const index = nextBatchIndex
        nextBatchIndex += 1
        if (index >= batches.length) return
        await this.upsertPointBatch(
          collection,
          batches[index] as Array<{
            id: string
            vector: number[]
            payload: Record<string, unknown>
          }>
        )
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
  }

  async deletePoints(collection: string, pointIds: string[]): Promise<void> {
    if (pointIds.length === 0) return

    const response = await this.request(`/collections/${collection}/points/delete?wait=true`, {
      method: 'POST',
      body: JSON.stringify({ points: pointIds }),
    })

    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Failed to delete points from Qdrant collection ${collection}: HTTP ${response.status}`
      )
    }
  }

  async searchPoints(
    collection: string,
    vector: number[],
    limit: number,
    filter: Record<string, unknown>
  ): Promise<QdrantSearchPoint[]> {
    const response = await this.request(`/collections/${collection}/points/search`, {
      method: 'POST',
      body: JSON.stringify({
        vector,
        limit,
        with_payload: true,
        filter,
      }),
    })

    if (response.status === 404) {
      return []
    }

    if (!response.ok) {
      throw new Error(`Failed to search Qdrant collection ${collection}: HTTP ${response.status}`)
    }

    const body = (await response.json()) as QdrantSearchResponse
    return Array.isArray(body.result) ? body.result : []
  }

  async retrievePointIds(collection: string, pointIds: string[]): Promise<Set<string>> {
    if (pointIds.length === 0) return new Set<string>()

    const result = new Set<string>()
    const batchSize = 128

    for (let offset = 0; offset < pointIds.length; offset += batchSize) {
      const batch = pointIds.slice(offset, offset + batchSize)
      const response = await this.request(`/collections/${collection}/points/retrieve`, {
        method: 'POST',
        body: JSON.stringify({
          ids: batch,
          with_payload: false,
          with_vector: false,
        }),
      })

      if (response.status === 404) {
        return new Set<string>()
      }

      if (!response.ok) {
        throw new Error(
          `Failed to retrieve points from Qdrant collection ${collection}: HTTP ${response.status}`
        )
      }

      const body = (await response.json()) as QdrantRetrieveResponse
      const points = Array.isArray(body.result) ? body.result : []
      for (const point of points) {
        result.add(String(point.id))
      }
    }

    return result
  }
}
