import type { ReplaceDocumentEmbeddingsInput } from '../ports/documentEmbeddings.port.js'

export const MAX_EMBEDDING_DIMENSIONS = 8192

export function normalizeQdrantCollectionPrefix(prefix: string): string {
  return prefix
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function qdrantCollectionName(dimensions: number, prefix: string): string {
  if (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > MAX_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Invalid embedding dimension ${dimensions}. Must be a positive integer <= ${MAX_EMBEDDING_DIMENSIONS}.`
    )
  }

  const normalizedPrefix = normalizeQdrantCollectionPrefix(prefix)

  if (!normalizedPrefix) {
    throw new Error('Qdrant collection prefix resolves to an empty value.')
  }

  return `${normalizedPrefix}_d${dimensions}`
}

export function validateEmbeddingVector(embedding: number[]): void {
  if (embedding.length === 0) {
    throw new Error('Embedding vector cannot be empty.')
  }

  if (embedding.length > MAX_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding vector exceeds the maximum supported dimension count (${MAX_EMBEDDING_DIMENSIONS}).`
    )
  }

  for (const [index, value] of embedding.entries()) {
    if (!Number.isFinite(value)) {
      throw new Error(`Embedding vector value ${index} is invalid.`)
    }
  }
}

export function validateSearchLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('Search limit must be a positive integer.')
  }

  return Math.min(limit, 200)
}

export function resolveChunkVectorKey(
  input: Pick<ReplaceDocumentEmbeddingsInput, 'documentId' | 'baseURL' | 'model'>,
  chunk: Pick<ReplaceDocumentEmbeddingsInput['chunks'][number], 'vectorKey' | 'ordinal'>,
  normalizedBaseURL: string,
  normalizedModel: string
): string {
  return (
    chunk.vectorKey?.trim() ||
    `${input.documentId}:${normalizedBaseURL}:${normalizedModel}:${chunk.ordinal}`
  )
}

export function validateReplacementChunks(input: ReplaceDocumentEmbeddingsInput): void {
  const ordinals = new Set<number>()
  const expectedDimensions = input.chunks[0]?.embedding.length ?? null

  for (const [index, chunk] of input.chunks.entries()) {
    if (!Number.isInteger(chunk.ordinal) || chunk.ordinal < 0) {
      throw new Error(`Embedding chunk ${index} has an invalid ordinal.`)
    }

    if (ordinals.has(chunk.ordinal)) {
      throw new Error(`Embedding chunk ordinal ${chunk.ordinal} is duplicated.`)
    }
    ordinals.add(chunk.ordinal)

    if (!Number.isInteger(chunk.start) || chunk.start < 0) {
      throw new Error(`Embedding chunk ${chunk.ordinal} has an invalid start offset.`)
    }

    if (!Number.isInteger(chunk.end) || chunk.end < chunk.start) {
      throw new Error(`Embedding chunk ${chunk.ordinal} has an invalid end offset.`)
    }

    const hasSelectionFrom = chunk.selectionFrom !== undefined && chunk.selectionFrom !== null
    const hasSelectionTo = chunk.selectionTo !== undefined && chunk.selectionTo !== null
    if (hasSelectionFrom !== hasSelectionTo) {
      throw new Error(`Embedding chunk ${chunk.ordinal} has an incomplete editor selection range.`)
    }
    if (hasSelectionFrom) {
      const selectionFrom = chunk.selectionFrom as number
      const selectionTo = chunk.selectionTo as number

      if (!Number.isInteger(selectionFrom) || selectionFrom < 0) {
        throw new Error(`Embedding chunk ${chunk.ordinal} has an invalid selection start.`)
      }
      if (!Number.isInteger(selectionTo) || selectionTo < selectionFrom) {
        throw new Error(`Embedding chunk ${chunk.ordinal} has an invalid selection end.`)
      }
    }

    validateEmbeddingVector(chunk.embedding)

    if (expectedDimensions !== null && chunk.embedding.length !== expectedDimensions) {
      throw new Error('Embedding provider returned inconsistent dimensions for one document.')
    }

    if (chunk.vectorKey !== undefined && chunk.vectorKey.trim().length === 0) {
      throw new Error(`Embedding chunk ${chunk.ordinal} has an invalid vector key.`)
    }
  }

  const sortedOrdinals = [...ordinals].sort((left, right) => left - right)
  for (const [index, ordinal] of sortedOrdinals.entries()) {
    if (ordinal !== index) {
      throw new Error('Embedding chunk ordinals must be contiguous and zero-based.')
    }
  }
}
