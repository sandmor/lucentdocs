use std::collections::{HashMap, HashSet};

use crate::storage::adapters::{normalize_base_url, with_transaction};
use crate::storage::dto::{
  DocumentEmbeddingDto, DocumentVectorPayloadContextDto, EmbeddingSearchMetadataDto,
  EmbeddingVectorReferenceDto, ReplaceDocumentEmbeddingsInputDto,
  ReplaceEmbeddingMetadataChunkDto,
};
use crate::storage::engine::StorageEngine;
use crate::storage::error::{StorageError, StorageResult};
use crate::storage::json_util::ids_json;

#[derive(sqlx::FromRow)]
struct EmbeddingRow {
  id: i64,
  #[sqlx(rename = "vectorKey")]
  vector_key: String,
  #[sqlx(rename = "documentId")]
  document_id: String,
  #[sqlx(rename = "providerConfigId")]
  provider_config_id: Option<String>,
  #[sqlx(rename = "providerId")]
  provider_id: String,
  r#type: String,
  #[sqlx(rename = "baseUrl")]
  base_url: String,
  model: String,
  #[sqlx(rename = "strategyType")]
  strategy_type: String,
  #[sqlx(rename = "strategyProperties")]
  strategy_properties_json: String,
  #[sqlx(rename = "chunkOrdinal")]
  chunk_ordinal: i32,
  #[sqlx(rename = "chunkStart")]
  chunk_start: i32,
  #[sqlx(rename = "chunkEnd")]
  chunk_end: i32,
  #[sqlx(rename = "selectionFrom")]
  selection_from: Option<i32>,
  #[sqlx(rename = "selectionTo")]
  selection_to: Option<i32>,
  #[sqlx(rename = "chunkText")]
  chunk_text: String,
  dimensions: i32,
  #[sqlx(rename = "documentTimestamp")]
  document_timestamp: i64,
  #[sqlx(rename = "contentHash")]
  content_hash: String,
  #[sqlx(rename = "createdAt")]
  created_at: i64,
  #[sqlx(rename = "updatedAt")]
  updated_at: i64,
}

#[derive(sqlx::FromRow)]
struct SearchRow {
  #[sqlx(rename = "vectorKey")]
  vector_key: String,
  #[sqlx(rename = "documentId")]
  document_id: String,
  title: String,
  #[sqlx(rename = "createdAt")]
  created_at: i64,
  #[sqlx(rename = "updatedAt")]
  updated_at: i64,
  #[sqlx(rename = "strategyType")]
  strategy_type: String,
  #[sqlx(rename = "chunkOrdinal")]
  chunk_ordinal: i32,
  #[sqlx(rename = "chunkStart")]
  chunk_start: i32,
  #[sqlx(rename = "chunkEnd")]
  chunk_end: i32,
  #[sqlx(rename = "selectionFrom")]
  selection_from: Option<i32>,
  #[sqlx(rename = "selectionTo")]
  selection_to: Option<i32>,
  #[sqlx(rename = "chunkText")]
  chunk_text: String,
}

fn row_to_dto(row: EmbeddingRow) -> DocumentEmbeddingDto {
  DocumentEmbeddingDto {
    id: row.id,
    vector_key: row.vector_key,
    document_id: row.document_id,
    provider_config_id: row.provider_config_id,
    provider_id: row.provider_id,
    r#type: row.r#type,
    base_url: row.base_url,
    model: row.model,
    strategy_type: row.strategy_type,
    strategy_properties_json: row.strategy_properties_json,
    chunk_ordinal: row.chunk_ordinal,
    chunk_start: row.chunk_start,
    chunk_end: row.chunk_end,
    selection_from: row.selection_from,
    selection_to: row.selection_to,
    chunk_text: row.chunk_text,
    dimensions: row.dimensions,
    document_timestamp: row.document_timestamp,
    content_hash: row.content_hash,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

fn split_document_path(title: &str) -> (String, Vec<String>) {
  let normalized = title.trim().trim_matches('/');
  if !normalized.contains('/') {
    return (String::new(), vec![String::new()]);
  }

  let parent_directory = normalized
    .rsplit_once('/')
    .map(|(parent, _)| parent.to_string())
    .unwrap_or_default();
  let segments: Vec<&str> = parent_directory
    .split('/')
    .filter(|segment| !segment.is_empty())
    .collect();
  let mut directory_ancestors = vec![String::new()];
  for index in 0..segments.len() {
    directory_ancestors.push(segments[..=index].join("/"));
  }

  (parent_directory, directory_ancestors)
}

async fn list_embedding_rows(
  conn: &mut sqlx::SqliteConnection,
  document_id: &str,
  base_url: &str,
  model: &str,
) -> StorageResult<Vec<DocumentEmbeddingDto>> {
  let rows = sqlx::query_as::<_, EmbeddingRow>(
    "SELECT de.rowid AS id,
            de.vectorKey,
            de.documentId,
            de.providerConfigId,
            de.providerId,
            de.type,
            de.baseUrl,
            de.model,
            de.strategyType,
            de.strategyProperties,
            de.chunkOrdinal,
            de.chunkStart,
            de.chunkEnd,
            de.selectionFrom,
            de.selectionTo,
            de.chunkText,
            de.dimensions,
            de.documentTimestamp,
            de.contentHash,
            de.createdAt,
            de.updatedAt
       FROM document_embeddings AS de
      WHERE de.documentId = ? AND de.baseUrl = ? AND de.model = ?
      ORDER BY de.chunkOrdinal ASC",
  )
  .bind(document_id)
  .bind(base_url)
  .bind(model)
  .fetch_all(&mut *conn)
  .await?;
  Ok(rows.into_iter().map(row_to_dto).collect())
}

pub async fn find_embeddings(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
  base_url: &str,
  model: &str,
) -> StorageResult<Vec<DocumentEmbeddingDto>> {
  let normalized_base_url = normalize_base_url(base_url);
  let normalized_model = model.trim();

  engine
    .with_conn(tx_id, async |conn| {
      list_embedding_rows(&mut *conn, document_id, &normalized_base_url, normalized_model).await
    })
    .await
}

pub async fn get_latest_timestamp(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
  base_url: &str,
  model: &str,
) -> StorageResult<Option<i64>> {
  let normalized_base_url = normalize_base_url(base_url);
  let normalized_model = model.trim();

  engine
    .with_conn(tx_id, async |conn| {
      let row = sqlx::query_as::<_, (Option<i64>,)>(
        "SELECT MAX(documentTimestamp) AS documentTimestamp
           FROM document_embeddings
          WHERE documentId = ? AND baseUrl = ? AND model = ?",
      )
      .bind(document_id)
      .bind(&normalized_base_url)
      .bind(normalized_model)
      .fetch_one(&mut *conn)
      .await?;
      Ok(row.0)
    })
    .await
}

pub async fn list_vector_references(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
  base_url: &str,
  model: &str,
) -> StorageResult<Vec<EmbeddingVectorReferenceDto>> {
  let normalized_base_url = normalize_base_url(base_url);
  let normalized_model = model.trim();

  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, (String, String, String, i32)>(
        "SELECT vectorKey, baseUrl, model, dimensions
           FROM document_embeddings
          WHERE documentId = ? AND baseUrl = ? AND model = ?",
      )
      .bind(document_id)
      .bind(&normalized_base_url)
      .bind(normalized_model)
      .fetch_all(&mut *conn)
      .await?;

      Ok(rows
        .into_iter()
        .map(|(vector_key, base_url, model, dimensions)| EmbeddingVectorReferenceDto {
          document_id: document_id.to_string(),
          vector_key,
          base_url,
          model,
          dimensions,
          vector_row_id: None,
        })
        .collect())
    })
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn replace_embeddings(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  input: &ReplaceDocumentEmbeddingsInputDto,
  chunks: &[ReplaceEmbeddingMetadataChunkDto],
) -> StorageResult<Vec<DocumentEmbeddingDto>> {
  let normalized_base_url = normalize_base_url(&input.base_url);
  let normalized_model = input.model.trim().to_string();

  with_transaction(engine, tx_id, async |engine, tx| {
    engine
      .with_conn(Some(tx), async |conn| {
        sqlx::query(
          "DELETE FROM document_embeddings
           WHERE documentId = ? AND baseUrl = ? AND model = ?",
        )
        .bind(&input.document_id)
        .bind(&normalized_base_url)
        .bind(&normalized_model)
        .execute(&mut *conn)
        .await?;

        for chunk in chunks {
          sqlx::query(
            "INSERT INTO document_embeddings
              (
                vectorKey,
                documentId,
                providerConfigId,
                providerId,
                type,
                baseUrl,
                model,
                strategyType,
                strategyProperties,
                chunkOrdinal,
                chunkStart,
                chunkEnd,
                selectionFrom,
                selectionTo,
                chunkText,
                dimensions,
                documentTimestamp,
                contentHash,
                createdAt,
                updatedAt
              )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(&chunk.vector_key)
          .bind(&input.document_id)
          .bind(&input.provider_config_id)
          .bind(&input.provider_id)
          .bind(&input.r#type)
          .bind(&normalized_base_url)
          .bind(&normalized_model)
          .bind(&input.strategy_type)
          .bind(&input.strategy_properties_json)
          .bind(chunk.ordinal)
          .bind(chunk.start)
          .bind(chunk.end)
          .bind(chunk.selection_from)
          .bind(chunk.selection_to)
          .bind(&chunk.text)
          .bind(chunk.dimensions)
          .bind(input.document_timestamp)
          .bind(&input.content_hash)
          .bind(input.created_at)
          .bind(input.updated_at)
          .execute(&mut *conn)
          .await?;
        }

        list_embedding_rows(&mut *conn, &input.document_id, &normalized_base_url, &normalized_model).await
      })
      .await
  })
  .await
}

pub async fn delete_embeddings_by_document_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query("DELETE FROM document_embeddings WHERE documentId = ?")
        .bind(document_id)
        .execute(&mut *conn)
        .await?;
      Ok(())
    })
    .await
}

pub async fn list_vector_references_by_document_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
) -> StorageResult<Vec<EmbeddingVectorReferenceDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, (String, String, String, i32)>(
        "SELECT vectorKey, baseUrl, model, dimensions FROM document_embeddings WHERE documentId = ?",
      )
      .bind(document_id)
      .fetch_all(&mut *conn)
      .await?;

      Ok(rows
        .into_iter()
        .map(|(vector_key, base_url, model, dimensions)| EmbeddingVectorReferenceDto {
          document_id: document_id.to_string(),
          vector_key,
          base_url,
          model,
          dimensions,
          vector_row_id: None,
        })
        .collect())
    })
    .await
}

pub async fn list_vector_references_by_document_ids(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_ids: &[String],
) -> StorageResult<Vec<EmbeddingVectorReferenceDto>> {
  let unique_document_ids: Vec<String> = document_ids
    .iter()
    .filter(|id| !id.is_empty())
    .cloned()
    .collect::<HashSet<_>>()
    .into_iter()
    .collect();

  if unique_document_ids.is_empty() {
    return Ok(Vec::new());
  }

  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, (String, String, String, String, i32)>(
        "WITH requested AS (
           SELECT value AS documentId
             FROM json_each(?)
         )
         SELECT de.documentId,
                de.vectorKey,
                de.baseUrl,
                de.model,
                de.dimensions
           FROM document_embeddings AS de
           JOIN requested ON requested.documentId = de.documentId",
      )
      .bind(ids_json(&unique_document_ids))
      .fetch_all(&mut *conn)
      .await?;

      Ok(rows
        .into_iter()
        .map(
          |(document_id, vector_key, base_url, model, dimensions)| EmbeddingVectorReferenceDto {
            document_id,
            vector_key,
            base_url,
            model,
            dimensions,
            vector_row_id: None,
          },
        )
        .collect())
    })
    .await
}

pub async fn delete_embeddings_by_vector_keys(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  vector_keys: &[String],
) -> StorageResult<i32> {
  let unique_vector_keys: Vec<String> = vector_keys
    .iter()
    .filter(|key| !key.is_empty())
    .cloned()
    .collect::<HashSet<_>>()
    .into_iter()
    .collect();

  if unique_vector_keys.is_empty() {
    return Ok(0);
  }

  engine
    .with_conn(tx_id, async |conn| {
      let before = sqlx::query_as::<_, (i64,)>(
        "WITH requested AS (
           SELECT value AS vectorKey
             FROM json_each(?)
         )
         SELECT COUNT(*) AS count
           FROM document_embeddings AS de
           JOIN requested ON requested.vectorKey = de.vectorKey",
      )
      .bind(ids_json(&unique_vector_keys))
      .fetch_one(&mut *conn)
      .await?;

      sqlx::query(
        "WITH requested AS (
           SELECT value AS vectorKey
             FROM json_each(?)
         )
         DELETE FROM document_embeddings
          WHERE vectorKey IN (SELECT vectorKey FROM requested)",
      )
      .bind(ids_json(&unique_vector_keys))
      .execute(&mut *conn)
      .await?;

      Ok(before.0 as i32)
    })
    .await
}

pub async fn get_vector_payload_context(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
) -> StorageResult<DocumentVectorPayloadContextDto> {
  engine
    .with_conn(tx_id, async |conn| {
      let document_row = sqlx::query_as::<_, (String, String)>(
        "SELECT id, title FROM documents WHERE id = ?",
      )
      .bind(document_id)
      .fetch_optional(&mut *conn)
      .await?
      .ok_or_else(|| {
        StorageError::new(format!(
          "Document {document_id} was not found while building vector payload context."
        ))
      })?;

      let project_rows = sqlx::query_as::<_, (String,)>(
        "SELECT projectId FROM project_documents WHERE documentId = ? ORDER BY projectId ASC",
      )
      .bind(document_id)
      .fetch_all(&mut *conn)
      .await?;

      let (parent_directory, directory_ancestors) = split_document_path(&document_row.1);
      let project_ids: Vec<String> = project_rows.into_iter().map(|(id,)| id).collect();

      Ok(DocumentVectorPayloadContextDto {
        document_id: document_row.0,
        title: document_row.1,
        project_ids_json: ids_json(&project_ids),
        parent_directory,
        directory_ancestors_json: serde_json::to_string(&directory_ancestors)?,
      })
    })
    .await
}

pub async fn list_search_metadata_by_vector_keys(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  vector_keys: &[String],
) -> StorageResult<HashMap<String, EmbeddingSearchMetadataDto>> {
  if vector_keys.is_empty() {
    return Ok(HashMap::new());
  }

  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, SearchRow>(
        "WITH requested AS (
           SELECT value AS vectorKey
             FROM json_each(?)
         )
         SELECT de.vectorKey,
                de.documentId,
                d.title,
                d.createdAt,
                d.updatedAt,
                de.strategyType,
                de.chunkOrdinal,
                de.chunkStart,
                de.chunkEnd,
                de.selectionFrom,
                de.selectionTo,
                de.chunkText
           FROM document_embeddings AS de
             JOIN requested ON requested.vectorKey = de.vectorKey
           JOIN documents AS d ON d.id = de.documentId
          ORDER BY de.documentId ASC, de.chunkOrdinal ASC",
      )
      .bind(ids_json(vector_keys))
      .fetch_all(&mut *conn)
      .await?;

      Ok(rows
        .into_iter()
        .map(|row| {
          (
            row.vector_key.clone(),
            EmbeddingSearchMetadataDto {
              vector_key: row.vector_key,
              document_id: row.document_id,
              title: row.title,
              created_at: row.created_at,
              updated_at: row.updated_at,
              strategy_type: row.strategy_type,
              chunk_ordinal: row.chunk_ordinal,
              chunk_start: row.chunk_start,
              chunk_end: row.chunk_end,
              selection_from: row.selection_from,
              selection_to: row.selection_to,
              chunk_text: row.chunk_text,
            },
          )
        })
        .collect())
    })
    .await
}
