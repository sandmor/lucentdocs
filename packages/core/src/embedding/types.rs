use napi_derive::napi;

/// A single document preparation request for embedding generation.
#[napi(object)]
pub struct EmbeddingDocumentRequest {
  pub document_id: String,
  pub title: String,
  pub content: String,
  pub strategy_json: String,
}

/// A prepared chunk that is ready to be sent to an embedding model.
#[napi(object)]
pub struct PreparedEmbeddingChunk {
  pub ordinal: u32,
  pub start: u32,
  pub end: u32,
  pub selection_from: Option<u32>,
  pub selection_to: Option<u32>,
  pub text: String,
}

/// A prepared document output with the projection text plus chunk metadata.
#[napi(object)]
pub struct PreparedEmbeddingDocument {
  pub document_id: String,
  pub projection_text: String,
  pub chunks: Vec<PreparedEmbeddingChunk>,
}

#[derive(Clone, Copy)]
pub(super) enum ChunkLevel {
  Sentence,
  Paragraph,
}

#[derive(Clone)]
pub(super) enum Strategy {
  WholeDocument,
  SlidingCharacter {
    window_size: usize,
    stride: usize,
  },
  SlidingStructured {
    level: ChunkLevel,
    window_size: usize,
    stride: usize,
    min_unit_chars: usize,
    max_unit_chars: usize,
  },
}

#[derive(Clone, Copy)]
pub(super) struct ChunkRange {
  pub start: usize,
  pub end: usize,
}

#[derive(Clone)]
pub(super) struct EmbeddingChunk {
  pub ordinal: usize,
  pub start: usize,
  pub end: usize,
  pub text: String,
}

#[derive(Clone)]
pub(super) struct DocumentProjectionRange {
  pub text_start: usize,
  pub text_end: usize,
  pub selection_from: usize,
}

#[derive(Clone)]
pub(super) struct DocumentEmbeddingProjection {
  pub text: String,
  pub ranges: Vec<DocumentProjectionRange>,
  pub grapheme_boundaries: Vec<usize>,
}

pub(super) struct ProjectionBuilderState {
  pub parts: Vec<String>,
  pub length: usize,
  pub ranges: Vec<DocumentProjectionRange>,
}
