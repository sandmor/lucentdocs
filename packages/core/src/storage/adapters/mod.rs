pub mod ai_model_selection;
pub mod ai_settings;
pub mod app_config;
pub mod auth_data;
pub mod chats;
pub mod document_content;
pub mod document_embedding_metadata;
pub mod document_embeddings;
pub mod document_notes;
pub mod documents;
pub mod indexing_settings;
pub mod job_queue;
pub mod persist_bundle;
pub mod project_documents;
pub mod projects;
pub mod version_snapshots;
pub mod yjs_documents;

use std::time::{SystemTime, UNIX_EPOCH};

use crate::storage::engine::StorageEngine;
use crate::storage::error::StorageResult;

pub(crate) fn now_ms() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis() as i64
}

pub(crate) fn normalize_base_url(value: &str) -> String {
  let trimmed = value.trim();
  if trimmed.is_empty() {
    return String::new();
  }
  let normalized = trimmed.trim_end_matches('/');
  if normalized.is_empty() {
    trimmed.to_string()
  } else {
    normalized.to_string()
  }
}

pub(crate) fn escape_sql_like_pattern(value: &str) -> String {
  value
    .replace('\\', "\\\\")
    .replace('%', "\\%")
    .replace('_', "\\_")
}

pub(crate) async fn with_transaction<T>(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  f: impl AsyncFnOnce(&StorageEngine, &str) -> StorageResult<T>,
) -> StorageResult<T> {
  if let Some(id) = tx_id {
    return f(engine, id).await;
  }

  let id = engine.begin_transaction().await?;
  let result = f(engine, &id).await;
  if result.is_ok() {
    engine.commit_transaction(&id).await?;
  } else {
    engine.rollback_transaction(&id).await?;
  }
  result
}
