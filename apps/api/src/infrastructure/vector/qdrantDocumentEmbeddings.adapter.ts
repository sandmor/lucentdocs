import { createHash } from 'node:crypto'
import type {
  DocumentEmbeddingVectorReference,
  DocumentEmbeddingsRepositoryPort,
  ProjectDocumentEmbeddingSearchMatch,
  ReplaceDocumentEmbeddingsInput,
  ReplaceDocumentEmbeddingsResult,
  SearchDocumentEmbeddingsInput,
  SearchProjectDocumentEmbeddingsInput,
} from '../../core/ports/documentEmbeddings.port.js'
import type {
  DocumentEmbeddingMetadataStorePort,
  ReplaceEmbeddingMetadataChunkInput,
} from '../../core/ports/documentEmbeddingMetadata.port.js'
import { normalizeBaseURL } from '../../core/ai/provider-types.js'
import {
  qdrantCollectionName,
  resolveChunkVectorKey,
  validateEmbeddingVector,
  validateReplacementChunks,
  validateSearchLimit,
} from '../../core/embeddings/documentEmbeddings.shared.js'

interface QdrantSearchPoint {
  id: number | string
  score?: number
  payload?: {
    vectorKey?: string
    documentId?: string
    baseUrl?: string
    model?: string
  }
}

interface QdrantSearchResponse {
  result?: QdrantSearchPoint[]
}

interface QdrantRetrievePoint {
  id: number | string
}

interface QdrantRetrieveResponse {
  result?: QdrantRetrievePoint[]
}

interface QdrantConfig {
  endpoint: string
  apiKey?: string
  collectionPrefix: string
  upsertBatchSize?: number
  upsertBatchConcurrency?: number
  fetchImpl?: typeof fetch
}

function qdrantPointId(vectorKey: string): string {
  const hex = createHash('sha256').update(vectorKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function normalizeDirectoryPath(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '')
}

function mustMatch(key: string, value: string): Record<string, unknown> {
  return { key, match: { value } }
}

export class QdrantDocumentEmbeddingsRepository implements DocumentEmbeddingsRepositoryPort {
  private readonly endpoint: string
  private readonly apiKey?: string
  private readonly collectionPrefix: string
  private readonly upsertBatchSize: number
  private readonly upsertBatchConcurrency: number
  private readonly fetchImpl: typeof fetch
  private readonly knownCollections = new Set<string>()

  constructor(
    private metadataStore: DocumentEmbeddingMetadataStorePort,
    config: QdrantConfig
  ) {
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

  private async ensureCollection(dimensions: number): Promise<string> {
    const collection = qdrantCollectionName(dimensions, this.collectionPrefix)
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

    this.knownCollections.add(collection)
    return collection
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

  private async upsertPoints(
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

  private async deletePoints(collection: string, pointIds: string[]): Promise<void> {
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

  private async searchPoints(
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

  private async retrievePointIds(collection: string, pointIds: string[]): Promise<Set<string>> {
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

  private async upsertNextVersionPoints(
    input: ReplaceDocumentEmbeddingsInput,
    normalizedBaseURL: string,
    normalizedModel: string,
    chunks: ReplaceEmbeddingMetadataChunkInput[]
  ): Promise<void> {
    const context = await this.metadataStore.getVectorPayloadContext(input.documentId)
    const embeddingsByOrdinal = new Map(
      input.chunks.map((chunk) => [chunk.ordinal, chunk.embedding])
    )

    const groupedUpserts = new Map<
      number,
      Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>
    >()

    for (const chunk of chunks) {
      const embedding = embeddingsByOrdinal.get(chunk.ordinal)
      if (!embedding) {
        throw new Error(`Missing embedding payload for chunk ordinal ${chunk.ordinal}.`)
      }

      const point = {
        id: qdrantPointId(chunk.vectorKey),
        vector: embedding,
        payload: {
          vectorKey: chunk.vectorKey,
          documentId: input.documentId,
          baseUrl: normalizedBaseURL,
          model: normalizedModel,
          chunkOrdinal: chunk.ordinal,
          parentDirectory: context.parentDirectory,
          directoryAncestors: context.directoryAncestors,
          projectIds: context.projectIds,
        },
      }

      const group = groupedUpserts.get(chunk.dimensions)
      if (group) group.push(point)
      else groupedUpserts.set(chunk.dimensions, [point])
    }

    for (const [dimensions, points] of groupedUpserts.entries()) {
      const collection = await this.ensureCollection(dimensions)
      await this.upsertPoints(collection, points)
    }
  }

  private async deleteExistingPointsBestEffort(
    rows: Array<{ vectorKey: string; dimensions: number }>
  ): Promise<void> {
    if (rows.length === 0) return

    const groupedDeletes = new Map<number, string[]>()
    for (const row of rows) {
      const pointId = qdrantPointId(row.vectorKey)
      const group = groupedDeletes.get(row.dimensions)
      if (group) group.push(pointId)
      else groupedDeletes.set(row.dimensions, [pointId])
    }

    for (const [dimensions, pointIds] of groupedDeletes.entries()) {
      try {
        const collection = qdrantCollectionName(dimensions, this.collectionPrefix)
        await this.deletePoints(collection, pointIds)
      } catch (error) {
        // Keep serving with the newly upserted vectors even if old vector cleanup fails.
        console.warn(
          `[vector] Failed to delete stale Qdrant points for dimension ${dimensions}:`,
          error
        )
      }
    }
  }

  async findEmbeddings(documentId: string, baseURL: string, model: string) {
    const embeddings = await this.metadataStore.findEmbeddings(documentId, baseURL, model)
    if (embeddings.length === 0) return embeddings

    const pointIdsByDimensions = new Map<number, string[]>()
    for (const embedding of embeddings) {
      const pointId = qdrantPointId(embedding.vectorKey)
      const group = pointIdsByDimensions.get(embedding.dimensions)
      if (group) group.push(pointId)
      else pointIdsByDimensions.set(embedding.dimensions, [pointId])
    }

    const existingPointIdsByDimensions = new Map<number, Set<string>>()
    try {
      for (const [dimensions, pointIds] of pointIdsByDimensions.entries()) {
        const collection = qdrantCollectionName(dimensions, this.collectionPrefix)
        existingPointIdsByDimensions.set(
          dimensions,
          await this.retrievePointIds(collection, pointIds)
        )
      }
    } catch (error) {
      // Keep indexing and stale-guard logic available even during transient Qdrant outages.
      console.warn('[vector] Failed to validate Qdrant points while listing embeddings:', error)
      return embeddings
    }

    return embeddings.filter((embedding) => {
      const group = existingPointIdsByDimensions.get(embedding.dimensions)
      if (!group || group.size === 0) return false
      return group.has(qdrantPointId(embedding.vectorKey))
    })
  }

  async searchDocument(
    input: SearchDocumentEmbeddingsInput
  ): Promise<ProjectDocumentEmbeddingSearchMatch[]> {
    validateEmbeddingVector(input.queryEmbedding)

    const limit = validateSearchLimit(input.limit)
    const dimensions = input.queryEmbedding.length
    const collection = qdrantCollectionName(dimensions, this.collectionPrefix)

    const points = await this.searchPoints(collection, input.queryEmbedding, limit, {
      must: [
        mustMatch('baseUrl', normalizeBaseURL(input.baseURL)),
        mustMatch('model', input.model.trim()),
        mustMatch('documentId', input.documentId),
      ],
    })

    const vectorKeys = points
      .map((point) => point.payload?.vectorKey)
      .filter((value): value is string => typeof value === 'string')

    const rowsByVectorKey = await this.metadataStore.listSearchMetadataByVectorKeys(vectorKeys)

    return points
      .map((point) => {
        const vectorKey = point.payload?.vectorKey
        if (typeof vectorKey !== 'string') return null
        const row = rowsByVectorKey.get(vectorKey)
        if (!row) return null

        return {
          ...row,
          distance: 1 - (point.score ?? 0),
        } satisfies ProjectDocumentEmbeddingSearchMatch
      })
      .filter((match): match is ProjectDocumentEmbeddingSearchMatch => match !== null)
  }

  async searchProjectDocuments(
    input: SearchProjectDocumentEmbeddingsInput
  ): Promise<ProjectDocumentEmbeddingSearchMatch[]> {
    validateEmbeddingVector(input.queryEmbedding)

    const limit = validateSearchLimit(input.limit)
    const dimensions = input.queryEmbedding.length
    const collection = qdrantCollectionName(dimensions, this.collectionPrefix)
    const normalizedDirectoryPath =
      input.scope.type === 'project' ? '' : normalizeDirectoryPath(input.scope.directoryPath)

    const must: Record<string, unknown>[] = [
      mustMatch('baseUrl', normalizeBaseURL(input.baseURL)),
      mustMatch('model', input.model.trim()),
      mustMatch('projectIds', input.projectId),
    ]

    if (input.scope.type === 'directory') {
      must.push(mustMatch('parentDirectory', normalizedDirectoryPath))
    } else if (input.scope.type === 'directory_subtree' && normalizedDirectoryPath !== '') {
      must.push(mustMatch('directoryAncestors', normalizedDirectoryPath))
    }

    const points = await this.searchPoints(collection, input.queryEmbedding, limit, { must })

    const vectorKeys = points
      .map((point) => point.payload?.vectorKey)
      .filter((value): value is string => typeof value === 'string')

    const rowsByVectorKey = await this.metadataStore.listSearchMetadataByVectorKeys(vectorKeys)

    return points
      .map((point) => {
        const vectorKey = point.payload?.vectorKey
        if (typeof vectorKey !== 'string') return null

        const row = rowsByVectorKey.get(vectorKey)
        if (!row) return null

        return {
          ...row,
          distance: 1 - (point.score ?? 0),
        } satisfies ProjectDocumentEmbeddingSearchMatch
      })
      .filter((match): match is ProjectDocumentEmbeddingSearchMatch => match !== null)
  }

  async replaceEmbeddings(
    input: ReplaceDocumentEmbeddingsInput
  ): Promise<ReplaceDocumentEmbeddingsResult> {
    validateReplacementChunks(input)

    const normalizedBaseURL = normalizeBaseURL(input.baseURL)
    const normalizedModel = input.model.trim()

    const latestStoredTimestamp = await this.metadataStore.getLatestTimestamp(
      input.documentId,
      normalizedBaseURL,
      normalizedModel
    )

    if (latestStoredTimestamp !== null && latestStoredTimestamp > input.documentTimestamp) {
      return {
        status: 'stale',
        embeddings: await this.metadataStore.findEmbeddings(
          input.documentId,
          normalizedBaseURL,
          normalizedModel
        ),
      }
    }

    const chunks: ReplaceEmbeddingMetadataChunkInput[] = input.chunks.map((chunk) => ({
      vectorKey: resolveChunkVectorKey(input, chunk, normalizedBaseURL, normalizedModel),
      ordinal: chunk.ordinal,
      start: chunk.start,
      end: chunk.end,
      selectionFrom: chunk.selectionFrom ?? null,
      selectionTo: chunk.selectionTo ?? null,
      text: chunk.text,
      dimensions: chunk.embedding.length,
    }))

    const existingRows = await this.metadataStore.listVectorReferences(
      input.documentId,
      normalizedBaseURL,
      normalizedModel
    )

    await this.upsertNextVersionPoints(input, normalizedBaseURL, normalizedModel, chunks)

    const embeddings = await this.metadataStore.replaceEmbeddings(input, chunks)

    await this.deleteExistingPointsBestEffort(existingRows)

    return {
      status: 'applied',
      embeddings,
    }
  }

  async listVectorReferencesByDocumentIds(
    documentIds: string[]
  ): Promise<DocumentEmbeddingVectorReference[]> {
    const uniqueDocumentIds = [...new Set(documentIds)].filter((id) => typeof id === 'string' && id)
    if (uniqueDocumentIds.length === 0) return []

    return this.metadataStore.listVectorReferencesByDocumentIds(uniqueDocumentIds)
  }

  async deleteVectorsByReferences(references: DocumentEmbeddingVectorReference[]): Promise<void> {
    const dedupedReferences = [
      ...new Map(
        references
          .filter(
            (reference) =>
              reference.vectorKey &&
              Number.isInteger(reference.dimensions) &&
              reference.dimensions > 0
          )
          .map((reference) => [`${reference.vectorKey}:${reference.dimensions}`, reference])
      ).values(),
    ]
    if (dedupedReferences.length === 0) return

    const vectorKeys = [...new Set(dedupedReferences.map((reference) => reference.vectorKey))]
    await this.metadataStore.deleteEmbeddingsByVectorKeys(vectorKeys)

    await this.deleteExistingPointsBestEffort(
      dedupedReferences.map((reference) => ({
        vectorKey: reference.vectorKey,
        dimensions: reference.dimensions,
      }))
    )
  }

  async deleteEmbeddingsByDocumentId(documentId: string): Promise<void> {
    const existingRows = await this.metadataStore.listVectorReferencesByDocumentId(documentId)

    await this.metadataStore.deleteEmbeddingsByDocumentId(documentId)

    await this.deleteExistingPointsBestEffort(existingRows)
  }
}
