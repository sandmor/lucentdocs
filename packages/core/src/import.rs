use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::Row;
use std::path::Path;
use std::str::FromStr;

use crate::markdown;
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

#[napi]
pub async fn import_markdown_documents_sqlite(
  db_path: String,
  request: MassImportRequest,
) -> std::result::Result<String, napi::Error> {
  // This helper writes through a native sqlx SQLite connection that can run
  // alongside the Bun SQLite handle used by the API process. Callers should
  // provide an adapter-specific synchronization step after commit (for SQLite,
  // refresh/reopen the Bun handle). Non-SQLite adapters (e.g. Postgres) do not
  // use this function.
  let sqlite_target = if db_path == ":memory:" {
    "sqlite::memory:".to_string()
  } else if db_path.starts_with("sqlite:") {
    db_path.clone()
  } else if Path::new(&db_path).is_absolute() {
    // Absolute filesystem path => sqlite:///abs/path
    format!("sqlite://{}", db_path)
  } else {
    // Relative filesystem path => sqlite://relative/path
    format!("sqlite://{}", db_path)
  };

  let connect_options = SqliteConnectOptions::from_str(&sqlite_target)
    .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid sqlite target: {}", e)))?
    .create_if_missing(true)
    .foreign_keys(true)
    .journal_mode(SqliteJournalMode::Wal)
    .synchronous(SqliteSynchronous::Full)
    .busy_timeout(std::time::Duration::from_secs(5));

  let pool = SqlitePoolOptions::new()
    .max_connections(1)
    .connect_with(connect_options)
    .await
    .map_err(|e| {
      Error::new(
        Status::GenericFailure,
        format!("Failed to connect sqlite: {}", e),
      )
    })?;

  let parse_failure_mode = request
    .parse_failure_mode
    .unwrap_or_else(|| "fail".to_string())
    .to_lowercase();

  let mut failed = Vec::<ImportFailure>::new();
  let mut imported = Vec::<ImportedDocumentResult>::new();

  let project_exists = sqlx::query("SELECT 1 FROM projects WHERE id = ? LIMIT 1")
    .bind(&request.project_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
      Error::new(
        Status::GenericFailure,
        format!("Failed to validate project: {}", e),
      )
    })?
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

    pool.close().await;

    let result = MassImportResult {
      imported: Vec::new(),
      failed,
    };
    return serde_json::to_string(&result).map_err(|e| {
      Error::new(
        Status::GenericFailure,
        format!("Failed to serialize result: {}", e),
      )
    });
  }

  let existing_rows = sqlx::query(
    "SELECT d.title
       FROM documents d
       JOIN project_documents pd ON pd.documentId = d.id
      WHERE pd.projectId = ?
        AND NOT EXISTS (
          SELECT 1
            FROM project_documents other
           WHERE other.documentId = d.id
             AND other.projectId <> ?
        )",
  )
  .bind(&request.project_id)
  .bind(&request.project_id)
  .fetch_all(&pool)
  .await
  .map_err(|e| {
    Error::new(
      Status::GenericFailure,
      format!("Failed to load existing paths: {}", e),
    )
  })?;

  let mut allocated_paths = existing_rows
    .into_iter()
    .filter_map(|row| row.try_get::<String, _>("title").ok())
    .map(|title| normalize_document_path(&title))
    .filter(|title| !title.is_empty())
    .collect::<Vec<_>>();

  let mut tx = pool.begin().await.map_err(|e| {
    Error::new(
      Status::GenericFailure,
      format!("Failed to begin import transaction: {}", e),
    )
  })?;

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

    sqlx::query(
      "INSERT INTO documents (id, title, type, metadata, createdAt, updatedAt)
       VALUES (?, ?, 'manuscript', NULL, ?, ?)",
    )
    .bind(&id)
    .bind(&unique_path)
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
      Error::new(
        Status::GenericFailure,
        format!("Failed to insert document: {}", e),
      )
    })?;

    sqlx::query(
      "INSERT INTO project_documents (projectId, documentId, addedAt)
       VALUES (?, ?, ?)",
    )
    .bind(&request.project_id)
    .bind(&id)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
      Error::new(
        Status::GenericFailure,
        format!("Failed to link imported document to project: {}", e),
      )
    })?;

    sqlx::query(
      "INSERT INTO yjs_documents (name, data)
       VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET data = excluded.data",
    )
    .bind(&id)
    .bind(&yjs_blob)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
      Error::new(
        Status::GenericFailure,
        format!("Failed to persist imported Yjs document: {}", e),
      )
    })?;

    imported.push(ImportedDocumentResult {
      id,
      title: unique_path,
    });
  }

  tx.commit().await.map_err(|e| {
    Error::new(
      Status::GenericFailure,
      format!("Failed to commit import transaction: {}", e),
    )
  })?;

  pool.close().await;

  let result = MassImportResult { imported, failed };
  serde_json::to_string(&result).map_err(|e| {
    Error::new(
      Status::GenericFailure,
      format!("Failed to serialize result: {}", e),
    )
  })
}
