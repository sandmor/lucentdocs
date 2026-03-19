import { prepareEmbeddingDocuments, type PreparedEmbeddingDocument } from '@lucentdocs/core'
import type { IndexingStrategy } from '@lucentdocs/shared'

export interface NativeEmbeddingPreparationRequest {
  documentId: string
  title: string
  content: string
  strategy: IndexingStrategy
}

export interface NativePreparedEmbeddingChunk {
  ordinal: number
  start: number
  end: number
  selectionFrom: number | null
  selectionTo: number | null
  estimatedTokens: number
  text: string
}

export interface NativePreparedEmbeddingDocument {
  documentId: string
  projectionText: string
  chunks: NativePreparedEmbeddingChunk[]
}

export async function prepareEmbeddingDocumentsNative(
  requests: NativeEmbeddingPreparationRequest[]
): Promise<NativePreparedEmbeddingDocument[]> {
  if (requests.length === 0) {
    return Promise.resolve([])
  }

  const prepared = await prepareEmbeddingDocuments(
    requests.map((request) => ({
      documentId: request.documentId,
      title: request.title,
      content: request.content,
      strategyJson: JSON.stringify(request.strategy),
    }))
  )

  return prepared.map((item: PreparedEmbeddingDocument) => ({
    documentId: item.documentId,
    projectionText: item.projectionText,
    chunks: item.chunks.map((chunk) => ({
      ordinal: chunk.ordinal,
      start: chunk.start,
      end: chunk.end,
      selectionFrom: chunk.selectionFrom ?? null,
      selectionTo: chunk.selectionTo ?? null,
      estimatedTokens: chunk.estimatedTokens,
      text: chunk.text,
    })),
  }))
}
