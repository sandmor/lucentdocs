use std::collections::HashSet;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::Serialize;

use crate::markdown;
use crate::storage::adapters::{documents, project_documents, projects, yjs_documents};
use crate::storage::dto::DocumentDto;
use crate::storage::engine::StorageEngine;
use crate::storage::error::StorageError;
use crate::MarkdownRawHtmlMode;

#[napi(object)]
pub struct MassImportDocumentInput {
  pub title: String,
  pub markdown: String,
}

#[napi(object)]
pub struct MassImportRequest {
  pub project_id: String,
  pub documents: Vec<MassImportDocumentInput>,
  pub parse_failure_mode: Option<String>,
  pub raw_html_mode: Option<MarkdownRawHtmlMode>,
}

#[derive(Serialize)]
struct ImportedDocumentResult {
  id: String,
  title: String,
}

#[derive(Serialize)]
struct ImportFailure {
  title: String,
  error: ImportError,
}

#[derive(Serialize)]
struct ImportError {
  kind: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  cause: Option<String>,
}

#[derive(Serialize)]
struct MassImportResult {
  imported: Vec<ImportedDocumentResult>,
  failed: Vec<ImportFailure>,
}

fn now_millis() -> i64 {
  use std::time::{SystemTime, UNIX_EPOCH};
  let duration = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default();
  duration.as_millis() as i64
}

fn normalize_document_path(input: &str) -> String {
  input
    .split('/')
    .map(|part| part.trim())
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join("/")
}

fn path_segments(path: &str) -> Vec<String> {
  let normalized = normalize_document_path(path);
  if normalized.is_empty() {
    return Vec::new();
  }
  normalized
    .split('/')
    .map(|part| part.to_string())
    .collect::<Vec<_>>()
}

fn path_has_sentinel_segment(path: &str) -> bool {
  path_segments(path).iter().any(|part| part == "__dir__")
}

fn is_directory_sentinel_path(path: &str) -> bool {
  let parts = path_segments(path);
  !parts.is_empty() && parts.last().map(|p| p.as_str()) == Some("__dir__")
}

fn has_ancestor_file_conflict(paths: &[String]) -> bool {
  let normalized = paths
    .iter()
    .map(|path| normalize_document_path(path))
    .filter(|path| !path.is_empty())
    .collect::<Vec<_>>();

  let file_paths = normalized
    .iter()
    .filter(|path| !is_directory_sentinel_path(path))
    .cloned()
    .collect::<HashSet<_>>();

  for path in normalized {
    let segments = path.split('/').collect::<Vec<_>>();
    for i in 1..segments.len() {
      let ancestor = segments[..i].join("/");
      if file_paths.contains(&ancestor) {
        return true;
      }
    }
  }

  false
}

fn resolve_unique_import_path(requested_path: &str, existing_paths: &[String]) -> String {
  let normalized = normalize_document_path(requested_path);
  if normalized.is_empty() {
    return "imported.md".to_string();
  }

  let path_set = existing_paths
    .iter()
    .map(|path| normalize_document_path(path))
    .collect::<HashSet<_>>();

  let mut initial_paths = existing_paths.to_vec();
  initial_paths.push(normalized.clone());

  if !path_set.contains(&normalized) && !has_ancestor_file_conflict(&initial_paths) {
    return normalized;
  }

  let last_dot = normalized.rfind('.');
  let (base, ext) = match last_dot {
    Some(index) if index > 0 => (&normalized[..index], &normalized[index..]),
    _ => (normalized.as_str(), ""),
  };

  for i in 1..=10000 {
    let candidate = format!("{}-{}{}", base, i, ext);
    let mut candidate_paths = existing_paths.to_vec();
    candidate_paths.push(candidate.clone());
    if !path_set.contains(&candidate) && !has_ancestor_file_conflict(&candidate_paths) {
      return candidate;
    }
  }

  "imported.md".to_string()
}

fn storage_err_to_napi(err: StorageError) -> Error {
  Error::new(Status::GenericFailure, err.to_string())
}

pub async fn import_markdown_documents(
  engine: &StorageEngine,
  request: MassImportRequest,
) -> std::result::Result<String, Error> {
  let parse_failure_mode = request
    .parse_failure_mode
    .unwrap_or_else(|| "fail".to_string())
    .to_lowercase();

  let mut failed = Vec::<ImportFailure>::new();
  let mut imported = Vec::<ImportedDocumentResult>::new();

  let project_exists = projects::find_by_id(engine, None, &request.project_id)
    .await
    .map_err(storage_err_to_napi)?
    .is_some();

  if !project_exists {
    for document in request.documents {
      failed.push(ImportFailure {
        title: document.title,
        error: ImportError {
          kind: "project_not_found".to_string(),
          cause: None,
        },
      });
    }

    let result = MassImportResult {
      imported: Vec::new(),
      failed,
    };
    return serde_json::to_string(&result).map_err(|e| {
      Error::new(
        Status::GenericFailure,
        format!("Failed to serialize result: {e}"),
      )
    });
  }

  let existing_titles =
    project_documents::find_sole_document_ids_by_project_id(engine, None, &request.project_id)
      .await
      .map_err(storage_err_to_napi)?;

  let mut allocated_paths = Vec::new();
  for document_id in &existing_titles {
    if let Some(doc) = documents::find_by_id(engine, None, document_id)
      .await
      .map_err(storage_err_to_napi)?
    {
      let normalized = normalize_document_path(&doc.title);
      if !normalized.is_empty() {
        allocated_paths.push(normalized);
      }
    }
  }

  let tx_id = engine.begin_transaction().await.map_err(storage_err_to_napi)?;
  let tx = Some(tx_id.as_str());

  for document in request.documents {
    let normalized_title = normalize_document_path(&document.title);
    if normalized_title.is_empty()
      || is_directory_sentinel_path(&normalized_title)
      || path_has_sentinel_segment(&normalized_title)
    {
      failed.push(ImportFailure {
        title: document.title,
        error: ImportError {
          kind: "invalid_path".to_string(),
          cause: None,
        },
      });
      continue;
    }

    let parsed_document = match markdown::ParsedMarkdownDocument::parse(
      &document.markdown,
      request
        .raw_html_mode
        .unwrap_or(MarkdownRawHtmlMode::CodeBlock),
    ) {
      Ok(parsed) => parsed,
      Err(error) => {
        if parse_failure_mode == "code_block" {
          markdown::ParsedMarkdownDocument::code_block_fallback(&document.markdown)
        } else {
          failed.push(ImportFailure {
            title: document.title,
            error: ImportError {
              kind: "markdown_parse_failed".to_string(),
              cause: Some(error),
            },
          });
          continue;
        }
      }
    };

    let yjs_blob = parsed_document.to_yjs_update();
    let unique_path = resolve_unique_import_path(&normalized_title, &allocated_paths);
    allocated_paths.push(unique_path.clone());

    let now = now_millis();
    let id = nanoid::nanoid!();

    if let Err(err) = documents::insert(
      engine,
      tx,
      &DocumentDto {
        id: id.clone(),
        title: unique_path.clone(),
        r#type: "manuscript".to_string(),
        metadata_json: None,
        created_at: now,
        updated_at: now,
      },
    )
    .await
    {
      engine.rollback_transaction(&tx_id).await.ok();
      return Err(storage_err_to_napi(err));
    }

    if let Err(err) = project_documents::insert(
      engine,
      tx,
      &crate::storage::dto::ProjectDocumentDto {
        project_id: request.project_id.clone(),
        document_id: id.clone(),
        added_at: now,
      },
    )
    .await
    {
      engine.rollback_transaction(&tx_id).await.ok();
      return Err(storage_err_to_napi(err));
    }

    if let Err(err) = yjs_documents::set(engine, tx, &id, &yjs_blob).await {
      engine.rollback_transaction(&tx_id).await.ok();
      return Err(storage_err_to_napi(err));
    }

    imported.push(ImportedDocumentResult {
      id,
      title: unique_path,
    });
  }

  engine
    .commit_transaction(&tx_id)
    .await
    .map_err(storage_err_to_napi)?;

  let result = MassImportResult { imported, failed };
  serde_json::to_string(&result).map_err(|e| {
    Error::new(
      Status::GenericFailure,
      format!("Failed to serialize result: {e}"),
    )
  })
}
