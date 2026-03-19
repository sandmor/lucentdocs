use rayon::prelude::*;

mod chunking;
mod projection;
mod strategy;
mod token_estimate;
mod types;

pub use types::{EmbeddingDocumentRequest, PreparedEmbeddingDocument};

/// Prepares embedding inputs for a batch of documents in parallel.
///
/// This keeps CPU-bound projection and chunking work in native code and
/// avoids hot loops in Node for large embedding backfills.
pub fn prepare_embedding_documents(
  requests: Vec<EmbeddingDocumentRequest>,
) -> Result<Vec<PreparedEmbeddingDocument>, String> {
  requests
    .into_par_iter()
    .map(prepare_single_document)
    .collect::<Result<Vec<_>, _>>()
}

fn checked_u32(value: usize, field: &str, document_id: &str) -> Result<u32, String> {
  u32::try_from(value).map_err(|_| {
    format!(
      "Prepared embedding chunk field '{field}' exceeds u32 range for document '{document_id}'."
    )
  })
}

fn prepare_single_document(
  request: EmbeddingDocumentRequest,
) -> Result<PreparedEmbeddingDocument, String> {
  let document_id = request.document_id.clone();
  let strategy = strategy::parse_strategy(&request.strategy_json)?;
  let projection =
    projection::build_document_embedding_projection(&request.title, &request.content)?;
  let base_chunks = chunking::build_embedding_chunks(&projection.text, &strategy);

  let chunks = base_chunks
    .into_iter()
    .map(|chunk| -> Result<types::PreparedEmbeddingChunk, String> {
      let selection = if matches!(strategy, types::Strategy::WholeDocument) {
        None
      } else {
        projection::map_projection_grapheme_range_to_selection(&projection, chunk.start, chunk.end)
      };

      let selection_from = selection
        .map(|(from, _)| checked_u32(from, "selection_from", &document_id))
        .transpose()?;
      let selection_to = selection
        .map(|(_, to)| checked_u32(to, "selection_to", &document_id))
        .transpose()?;

      Ok(types::PreparedEmbeddingChunk {
        ordinal: checked_u32(chunk.ordinal, "ordinal", &document_id)?,
        start: checked_u32(chunk.start, "start", &document_id)?,
        end: checked_u32(chunk.end, "end", &document_id)?,
        selection_from,
        selection_to,
        estimated_tokens: u32::try_from(token_estimate::estimate_tokens_with_buffer(&chunk.text))
          .map_err(|_| {
          format!(
            "Estimated token count exceeds u32 range for document '{document_id}' chunk {}.",
            chunk.ordinal
          )
        })?,
        text: chunk.text,
      })
    })
    .collect::<Result<Vec<_>, _>>()?;

  Ok(PreparedEmbeddingDocument {
    document_id: request.document_id,
    projection_text: projection.text,
    chunks,
  })
}
