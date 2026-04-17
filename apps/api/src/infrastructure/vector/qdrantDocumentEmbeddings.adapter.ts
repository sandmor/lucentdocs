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
  resolveChunkVectorKey,
  validateEmbeddingVector,
  validateReplacementChunks,
  validateSearchLimit,
} from '../../core/embeddings/documentEmbeddings.shared.js'
import { qdrantPointId, type QdrantClient } from './qdrant.client.js'

function normalizeDirectoryPath(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '')
}

function mustMatch(key: string, value: string): Record<string, unknown> {
  return { key, match: { value } }
}

export class QdrantDocumentEmbeddingsRepository implements DocumentEmbeddingsRepositoryPort {
  constructor(
    private metadataStore: DocumentEmbeddingMetadataStorePort,
    private client: QdrantClient
  ) {}

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
      const collection = await this.client.ensureCollection(
        dimensions,
        normalizedBaseURL,
        normalizedModel
      )
      await this.client.upsertPoints(collection, points)
    }
  }

  private async deleteExistingPointsBestEffort(
    rows: Array<{ vectorKey: string; baseURL: string; model: string; dimensions: number }>
  ): Promise<void> {
    if (rows.length === 0) return

    const groupedDeletes = new Map<string, { collection: string; pointIds: string[] }>()
    for (const row of rows) {
      const pointId = qdrantPointId(row.vectorKey)
      const collection = this.client.collectionName(row.dimensions, row.baseURL, row.model)
      const group = groupedDeletes.get(collection)
      if (group) group.pointIds.push(pointId)
      else groupedDeletes.set(collection, { collection, pointIds: [pointId] })
    }

    for (const { collection, pointIds } of groupedDeletes.values()) {
      try {
        await this.client.deletePoints(collection, pointIds)
      } catch (error) {
        console.warn(
          `[vector] Failed to delete stale Qdrant points for collection ${collection}:`,
          error
        )
      }
    }
  }

  async findEmbeddings(documentId: string, baseURL: string, model: string) {
    const embeddings = await this.metadataStore.findEmbeddings(documentId, baseURL, model)
    if (embeddings.length === 0) return embeddings

    const pointIdsByDimensions = new Map<number, string[]>()
    const collectionsByDimensions = new Map<number, string>()
    for (const embedding of embeddings) {
      const pointId = qdrantPointId(embedding.vectorKey)
      const group = pointIdsByDimensions.get(embedding.dimensions)
      if (group) group.push(pointId)
      else pointIdsByDimensions.set(embedding.dimensions, [pointId])
      collectionsByDimensions.set(
        embedding.dimensions,
        this.client.collectionName(embedding.dimensions, embedding.baseURL, embedding.model)
      )
    }

    const existingPointIdsByDimensions = new Map<number, Set<string>>()
    try {
      for (const [dimensions, pointIds] of pointIdsByDimensions.entries()) {
        const collection = collectionsByDimensions.get(dimensions)
        if (!collection) continue
        existingPointIdsByDimensions.set(
          dimensions,
          await this.client.retrievePointIds(collection, pointIds)
        )
      }
    } catch (error) {
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
    const normalizedBaseURL = normalizeBaseURL(input.baseURL)
    const normalizedModel = input.model.trim()
    const collection = this.client.collectionName(dimensions, normalizedBaseURL, normalizedModel)

    const points = await this.client.searchPoints(collection, input.queryEmbedding, limit, {
      must: [
        mustMatch('baseUrl', normalizedBaseURL),
        mustMatch('model', normalizedModel),
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
    const normalizedBaseURL = normalizeBaseURL(input.baseURL)
    const normalizedModel = input.model.trim()
    const collection = this.client.collectionName(dimensions, normalizedBaseURL, normalizedModel)
    const normalizedDirectoryPath =
      input.scope.type === 'project' ? '' : normalizeDirectoryPath(input.scope.directoryPath)

    const must: Record<string, unknown>[] = [
      mustMatch('baseUrl', normalizedBaseURL),
      mustMatch('model', normalizedModel),
      mustMatch('projectIds', input.projectId),
    ]

    if (input.scope.type === 'directory') {
      must.push(mustMatch('parentDirectory', normalizedDirectoryPath))
    } else if (input.scope.type === 'directory_subtree' && normalizedDirectoryPath !== '') {
      must.push(mustMatch('directoryAncestors', normalizedDirectoryPath))
    }

    const points = await this.client.searchPoints(collection, input.queryEmbedding, limit, { must })

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
              typeof reference.baseURL === 'string' &&
              reference.baseURL.length > 0 &&
              typeof reference.model === 'string' &&
              reference.model.trim().length > 0 &&
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
        baseURL: reference.baseURL,
        model: reference.model,
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
