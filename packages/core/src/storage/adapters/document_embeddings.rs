use std::collections::{HashMap, HashSet};

use sqlx::SqliteConnection;

use crate::storage::adapters::{escape_sql_like_pattern, normalize_base_url, with_transaction};
use crate::storage::dto::{
  DocumentEmbeddingDto, EmbeddingSearchMatchDto, EmbeddingVectorReferenceDto,
  ReplaceDocumentEmbeddingsInputDto, ReplaceDocumentEmbeddingsResultDto,
  SearchDocumentEmbeddingsInputDto,
};
use crate::storage::engine::StorageEngine;
use crate::storage::error::{StorageError, StorageResult};
use crate::storage::json_util::ids_json;
use crate::storage::vec_extension;

const MAX_EMBEDDING_DIMENSIONS: i32 = 8192;

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
struct SearchMatchRow {
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
  distance: f64,
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

fn search_row_to_dto(row: SearchMatchRow) -> EmbeddingSearchMatchDto {
  EmbeddingSearchMatchDto {
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
    distance: row.distance,
  }
}

fn embedding_json_to_f32_vec(embedding_json: &str) -> StorageResult<Vec<f32>> {
  let values: Vec<f32> = serde_json::from_str(embedding_json)?;
  validate_embedding_vector(&values)?;
  Ok(values)
}

fn embedding_f32_to_bytes(values: &[f32]) -> Vec<u8> {
  values
    .iter()
    .flat_map(|value| value.to_le_bytes())
    .collect()
}

fn validate_embedding_vector(values: &[f32]) -> StorageResult<()> {
  if values.is_empty() {
    return Err(StorageError::new("Embedding vector cannot be empty."));
  }
  if values.len() as i32 > MAX_EMBEDDING_DIMENSIONS {
    return Err(StorageError::new(format!(
      "Embedding vector exceeds the maximum supported dimension count ({MAX_EMBEDDING_DIMENSIONS})."
    )));
  }
  for (index, value) in values.iter().enumerate() {
    if !value.is_finite() {
      return Err(StorageError::new(format!(
        "Embedding vector value {index} is invalid."
      )));
    }
  }
  Ok(())
}

fn validate_search_limit(limit: i32) -> StorageResult<i32> {
  if limit <= 0 {
    return Err(StorageError::new("Search limit must be a positive integer."));
  }
  Ok(limit.min(200))
}

fn resolve_chunk_vector_key(
  document_id: &str,
  ordinal: i32,
  vector_key: Option<&str>,
  normalized_base_url: &str,
  normalized_model: &str,
) -> StorageResult<String> {
  if let Some(key) = vector_key {
    let trimmed = key.trim();
    if trimmed.is_empty() {
      return Err(StorageError::new(format!(
        "Embedding chunk {ordinal} has an invalid vector key."
      )));
    }
    return Ok(trimmed.to_string());
  }
  Ok(format!(
    "{document_id}:{normalized_base_url}:{normalized_model}:{ordinal}"
  ))
}

fn validate_replacement_chunks(input: &ReplaceDocumentEmbeddingsInputDto) -> StorageResult<()> {
  let mut ordinals = HashSet::new();
  let mut expected_dimensions: Option<usize> = None;

  for (index, chunk) in input.chunks.iter().enumerate() {
    if chunk.ordinal < 0 {
      return Err(StorageError::new(format!(
        "Embedding chunk {index} has an invalid ordinal."
      )));
    }
    if !ordinals.insert(chunk.ordinal) {
      return Err(StorageError::new(format!(
        "Embedding chunk ordinal {} is duplicated.",
        chunk.ordinal
      )));
    }
    if chunk.start < 0 {
      return Err(StorageError::new(format!(
        "Embedding chunk {} has an invalid start offset.",
        chunk.ordinal
      )));
    }
    if chunk.end < chunk.start {
      return Err(StorageError::new(format!(
        "Embedding chunk {} has an invalid end offset.",
        chunk.ordinal
      )));
    }

    let has_selection_from = chunk.selection_from.is_some();
    let has_selection_to = chunk.selection_to.is_some();
    if has_selection_from != has_selection_to {
      return Err(StorageError::new(format!(
        "Embedding chunk {} has an incomplete editor selection range.",
        chunk.ordinal
      )));
    }
    if let (Some(from), Some(to)) = (chunk.selection_from, chunk.selection_to) {
      if from < 0 {
        return Err(StorageError::new(format!(
          "Embedding chunk {} has an invalid selection start.",
          chunk.ordinal
        )));
      }
      if to < from {
        return Err(StorageError::new(format!(
          "Embedding chunk {} has an invalid selection end.",
          chunk.ordinal
        )));
      }
    }

    let embedding = embedding_json_to_f32_vec(&chunk.embedding_json)?;
    if let Some(expected) = expected_dimensions {
      if embedding.len() != expected {
        return Err(StorageError::new(
          "Embedding provider returned inconsistent dimensions for one document.",
        ));
      }
    } else {
      expected_dimensions = Some(embedding.len());
    }
  }

  let mut sorted_ordinals: Vec<i32> = ordinals.into_iter().collect();
  sorted_ordinals.sort_unstable();
  for (index, ordinal) in sorted_ordinals.iter().enumerate() {
    if *ordinal != index as i32 {
      return Err(StorageError::new(
        "Embedding chunk ordinals must be contiguous and zero-based.",
      ));
    }
  }

  Ok(())
}

async fn has_vector_table(conn: &mut SqliteConnection, table_name: &str) -> StorageResult<bool> {
  let row = sqlx::query_as::<_, (i32,)>(
    "SELECT 1 AS found
       FROM sqlite_master
      WHERE type = 'table' AND name = ?
      LIMIT 1",
  )
  .bind(table_name)
  .fetch_optional(&mut *conn)
  .await?;
  Ok(row.is_some())
}

async fn lookup_vector_row_id(conn: &mut SqliteConnection, vector_key: &str) -> StorageResult<i64> {
  let row = sqlx::query_as::<_, (i64,)>(
    "SELECT id FROM document_embedding_vector_rows WHERE vectorKey = ?",
  )
  .bind(vector_key)
  .fetch_optional(&mut *conn)
  .await?
  .ok_or_else(|| StorageError::new("Failed to read stored document embedding vector row."))?;
  Ok(row.0)
}

async fn list_embedding_vector_rows(
  conn: &mut SqliteConnection,
  document_id: &str,
  base_url: &str,
  model: &str,
) -> StorageResult<Vec<(i64, String, i32)>> {
  let rows = sqlx::query_as::<_, (i64, String, i32)>(
    "SELECT vr.id, vr.vectorKey, vr.dimensions
       FROM document_embedding_vector_rows AS vr
       JOIN document_embeddings AS de ON de.vectorKey = vr.vectorKey
      WHERE de.documentId = ? AND de.baseUrl = ? AND de.model = ?",
  )
  .bind(document_id)
  .bind(base_url)
  .bind(model)
  .fetch_all(&mut *conn)
  .await?;
  Ok(rows)
}

async fn list_embedding_rows(
  conn: &mut SqliteConnection,
  document_id: &str,
  base_url: &str,
  model: &str,
) -> StorageResult<Vec<DocumentEmbeddingDto>> {
  let rows = sqlx::query_as::<_, EmbeddingRow>(
    "SELECT vr.id,
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
       JOIN document_embedding_vector_rows AS vr ON vr.vectorKey = de.vectorKey
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

enum SearchScope<'a> {
  Document { document_id: &'a str },
  Project {
    project_id: &'a str,
    directory_path: Option<&'a str>,
    directory_exact: bool,
  },
}

async fn search_matches(
  conn: &mut SqliteConnection,
  input: &SearchDocumentEmbeddingsInputDto,
  query_embedding_json: &str,
  normalized_base_url: &str,
  model: &str,
  scope: SearchScope<'_>,
) -> StorageResult<Vec<EmbeddingSearchMatchDto>> {
  let query_embedding = embedding_json_to_f32_vec(query_embedding_json)?;
  let dimensions = query_embedding.len() as i32;
  let limit = validate_search_limit(input.limit)?;
  let table_name = vec_extension::vector_table_name(dimensions)?;

  if !has_vector_table(&mut *conn, &table_name).await? {
    return Ok(Vec::new());
  }

  let mut scope_fragments = Vec::new();
  let mut scope_params: Vec<String> = Vec::new();

  match scope {
    SearchScope::Document { document_id } => {
      scope_fragments.push("candidate.documentId = ?".to_string());
      scope_params.push(document_id.to_string());
    }
    SearchScope::Project {
      project_id,
      directory_path,
      directory_exact,
    } => {
      scope_fragments.push(
        "candidate.documentId IN (
            SELECT pd.documentId
              FROM project_documents AS pd
              JOIN documents AS scoped_doc ON scoped_doc.id = pd.documentId
             WHERE pd.projectId = ?"
          .to_string(),
      );
      scope_params.push(project_id.to_string());

      if let Some(path) = directory_path {
        if !path.is_empty() {
          let escaped = escape_sql_like_pattern(path);
          if directory_exact {
            scope_fragments.push(
              "               AND scoped_doc.title LIKE ? ESCAPE '\\'
                   AND scoped_doc.title NOT LIKE ? ESCAPE '\\'".to_string(),
            );
            scope_params.push(format!("{escaped}/%"));
            scope_params.push(format!("{escaped}/%/%"));
          } else {
            scope_fragments.push(
              "               AND (
                    scoped_doc.title = ?
                    OR scoped_doc.title LIKE ? ESCAPE '\\'
                  )"
                .to_string(),
            );
            scope_params.push(path.to_string());
            scope_params.push(format!("{escaped}/%"));
          }
        } else if directory_exact {
          scope_fragments.push("               AND scoped_doc.title NOT LIKE ? ESCAPE '\\'".to_string());
          scope_params.push("%/%".to_string());
        }
      }

      scope_fragments.push("          )".to_string());
    }
  }

  let scope_sql = scope_fragments.join("\n");
  let query_bytes = embedding_f32_to_bytes(&query_embedding);

  let sql = format!(
    "SELECT de.documentId,
            d.title,
            d.createdAt,
            d.updatedAt,
            de.strategyType,
            de.chunkOrdinal,
            de.chunkStart,
            de.chunkEnd,
            de.selectionFrom,
            de.selectionTo,
            de.chunkText,
            v.distance
       FROM {table_name} AS v
       JOIN document_embedding_vector_rows AS vr ON vr.id = v.rowid
       JOIN document_embeddings AS de ON de.vectorKey = vr.vectorKey
       JOIN documents AS d ON d.id = de.documentId
      WHERE v.embedding MATCH ?
        AND k = ?
        AND v.rowid IN (
          SELECT candidate_vr.id
            FROM document_embedding_vector_rows AS candidate_vr
            JOIN document_embeddings AS candidate ON candidate.vectorKey = candidate_vr.vectorKey
           WHERE candidate_vr.dimensions = ?
             AND {scope_sql}
             AND candidate.baseUrl = ?
             AND candidate.model = ?
        )
      ORDER BY v.distance ASC, de.documentId ASC, de.chunkOrdinal ASC"
  );

  let mut query = sqlx::query_as::<_, SearchMatchRow>(&sql)
    .bind(query_bytes)
    .bind(limit)
    .bind(dimensions);

  for value in scope_params {
    query = query.bind(value);
  }
  query = query.bind(normalized_base_url).bind(model);

  let rows = query.fetch_all(&mut *conn).await?;
  Ok(rows.into_iter().map(search_row_to_dto).collect())
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

pub async fn search(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  input: &SearchDocumentEmbeddingsInputDto,
) -> StorageResult<Vec<EmbeddingSearchMatchDto>> {
  let normalized_base_url = normalize_base_url(&input.base_url);
  let normalized_model = input.model.trim();

  engine
    .with_conn(tx_id, async |conn| {
      if let Some(document_id) = input.document_id.as_deref() {
        return search_matches(&mut *conn,
          input,
          &input.query_embedding_json,
          &normalized_base_url,
          normalized_model,
          SearchScope::Document { document_id },
        )
        .await;
      }

      let project_id = input
        .project_id
        .as_deref()
        .ok_or_else(|| StorageError::new("project_id or document_id is required for search."))?;

      let directory_exact = input.scope_type == "directory";
      search_matches(&mut *conn,
        input,
        &input.query_embedding_json,
        &normalized_base_url,
        normalized_model,
        SearchScope::Project {
          project_id,
          directory_path: input.directory_path.as_deref(),
          directory_exact,
        },
      )
      .await
    })
    .await
}

pub async fn replace_embeddings(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  input: &ReplaceDocumentEmbeddingsInputDto,
) -> StorageResult<ReplaceDocumentEmbeddingsResultDto> {
  validate_replacement_chunks(input)?;

  let normalized_base_url = normalize_base_url(&input.base_url);
  let normalized_model = input.model.trim().to_string();

  with_transaction(engine, tx_id, async |engine, tx| {
    engine
      .with_conn(Some(tx), async |conn| {
        let latest = sqlx::query_as::<_, (Option<i64>,)>(
          "SELECT MAX(documentTimestamp) AS documentTimestamp
             FROM document_embeddings
            WHERE documentId = ? AND baseUrl = ? AND model = ?",
        )
        .bind(&input.document_id)
        .bind(&normalized_base_url)
        .bind(&normalized_model)
        .fetch_one(&mut *conn)
        .await?;

        if let Some(stored) = latest.0 {
          if stored > input.document_timestamp {
            let embeddings =
              list_embedding_rows(&mut *conn, &input.document_id, &normalized_base_url, &normalized_model)
                .await?;
            return Ok(ReplaceDocumentEmbeddingsResultDto {
              status: "stale".to_string(),
              embeddings,
            });
          }
        }

        let existing =
          list_embedding_vector_rows(&mut *conn, &input.document_id, &normalized_base_url, &normalized_model)
            .await?;
        for (row_id, _, dimensions) in existing {
          let table = vec_extension::vector_table_name(dimensions)?;
          sqlx::query(&format!("DELETE FROM {table} WHERE rowid = ?"))
            .bind(row_id)
            .execute(&mut *conn)
            .await?;
        }

        sqlx::query(
          "DELETE FROM document_embeddings
           WHERE documentId = ? AND baseUrl = ? AND model = ?",
        )
        .bind(&input.document_id)
        .bind(&normalized_base_url)
        .bind(&normalized_model)
        .execute(&mut *conn)
        .await?;

        for chunk in &input.chunks {
          let embedding = embedding_json_to_f32_vec(&chunk.embedding_json)?;
          let dimensions = embedding.len() as i32;
          let table = vec_extension::vector_table_name(dimensions)?;
          let vector_key = resolve_chunk_vector_key(
            &input.document_id,
            chunk.ordinal,
            chunk.vector_key.as_deref(),
            &normalized_base_url,
            &normalized_model,
          )?;

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
          .bind(&vector_key)
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
          .bind(dimensions)
          .bind(input.document_timestamp)
          .bind(&input.content_hash)
          .bind(input.created_at)
          .bind(input.updated_at)
          .execute(&mut *conn)
          .await?;

          sqlx::query(
            "INSERT INTO document_embedding_vector_rows (vectorKey, dimensions) VALUES (?, ?)",
          )
          .bind(&vector_key)
          .bind(dimensions)
          .execute(&mut *conn)
          .await?;

          let vector_row_id = lookup_vector_row_id(&mut *conn, &vector_key).await?;
          vec_extension::ensure_vector_table(conn, dimensions).await?;
          sqlx::query(&format!("DELETE FROM {table} WHERE rowid = ?"))
            .bind(vector_row_id)
            .execute(&mut *conn)
            .await?;
          sqlx::query(&format!("INSERT INTO {table} (rowid, embedding) VALUES (?, ?)"))
            .bind(vector_row_id)
            .bind(embedding_f32_to_bytes(&embedding))
            .execute(&mut *conn)
            .await?;
        }

        let embeddings =
          list_embedding_rows(&mut *conn, &input.document_id, &normalized_base_url, &normalized_model)
            .await?;
        Ok(ReplaceDocumentEmbeddingsResultDto {
          status: "applied".to_string(),
          embeddings,
        })
      })
      .await
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
      let rows = sqlx::query_as::<_, (String, String, String, String, i32, Option<i64>)>(
        "WITH requested AS (
           SELECT value AS documentId
             FROM json_each(?)
         )
         SELECT de.documentId,
                de.vectorKey,
                de.baseUrl,
                de.model,
                de.dimensions,
                vr.id
           FROM document_embeddings AS de
           JOIN requested ON requested.documentId = de.documentId
           LEFT JOIN document_embedding_vector_rows AS vr ON vr.vectorKey = de.vectorKey",
      )
      .bind(ids_json(&unique_document_ids))
      .fetch_all(&mut *conn)
      .await?;

      Ok(rows
        .into_iter()
        .map(
          |(document_id, vector_key, base_url, model, dimensions, vector_row_id)| {
            EmbeddingVectorReferenceDto {
              document_id,
              vector_key,
              base_url,
              model,
              dimensions,
              vector_row_id,
            }
          },
        )
        .collect())
    })
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn delete_vectors_by_references(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  references: &[EmbeddingVectorReferenceDto],
) -> StorageResult<()> {
  if references.is_empty() {
    return Ok(());
  }

  let mut unique = HashMap::new();
  for reference in references {
    if reference.vector_key.is_empty()
      || reference.dimensions <= 0
      || reference
        .vector_row_id
        .is_some_and(|row_id| row_id <= 0)
    {
      continue;
    }
    unique.insert(
      format!(
        "{}:{}:{}",
        reference.vector_key,
        reference.dimensions,
        reference
          .vector_row_id
          .map(|row_id| row_id.to_string())
          .unwrap_or_default()
      ),
      reference.clone(),
    );
  }

  if unique.is_empty() {
    return Ok(());
  }

  let unique_references: Vec<EmbeddingVectorReferenceDto> = unique.into_values().collect();
  let all_vector_keys: Vec<String> = unique_references
    .iter()
    .map(|reference| reference.vector_key.clone())
    .collect::<HashSet<_>>()
    .into_iter()
    .collect();

  let mut grouped_by_dimensions: HashMap<i32, (HashSet<String>, HashSet<i64>)> = HashMap::new();
  for reference in &unique_references {
    let entry = grouped_by_dimensions
      .entry(reference.dimensions)
      .or_insert_with(|| (HashSet::new(), HashSet::new()));
    entry.0.insert(reference.vector_key.clone());
    if let Some(row_id) = reference.vector_row_id {
      entry.1.insert(row_id);
    }
  }
  let dimension_keys: Vec<i32> = grouped_by_dimensions.keys().copied().collect();

  with_transaction(engine, tx_id, async |engine, tx| {
    engine
      .with_conn(Some(tx), async |conn| {
        let mut resolved_row_ids_by_dimensions: HashMap<i32, Vec<i64>> = HashMap::new();

        for (dimensions, (vector_keys, row_ids)) in grouped_by_dimensions {
          if !row_ids.is_empty() {
            resolved_row_ids_by_dimensions.insert(dimensions, row_ids.into_iter().collect());
            continue;
          }

          if vector_keys.is_empty() {
            continue;
          }

          let keys_json = ids_json(&vector_keys.into_iter().collect::<Vec<_>>());
          let rows = sqlx::query_as::<_, (i64,)>(
            "WITH requested AS (
               SELECT value AS vectorKey
                 FROM json_each(?)
             )
             SELECT vr.id
               FROM document_embedding_vector_rows AS vr
               JOIN requested ON requested.vectorKey = vr.vectorKey
              WHERE vr.dimensions = ?",
          )
          .bind(keys_json)
          .bind(dimensions)
          .fetch_all(&mut *conn)
          .await?;

          if !rows.is_empty() {
            resolved_row_ids_by_dimensions.insert(
              dimensions,
              rows.into_iter().map(|(id,)| id).collect(),
            );
          }
        }

        for (dimensions, row_ids) in resolved_row_ids_by_dimensions {
          if row_ids.is_empty() {
            continue;
          }
          let table = vec_extension::vector_table_name(dimensions)?;
          let row_id_json = ids_json(
            &row_ids
              .iter()
              .map(|row_id| row_id.to_string())
              .collect::<Vec<_>>(),
          );

          if has_vector_table(&mut *conn, &table).await? {
            sqlx::query(&format!(
              "WITH requested_ids AS (
                 SELECT CAST(value AS INTEGER) AS rowId
                   FROM json_each(?)
               )
               DELETE FROM {table}
                WHERE rowid IN (SELECT rowId FROM requested_ids)"
            ))
            .bind(&row_id_json)
            .execute(&mut *conn)
            .await?;
          }

          sqlx::query(
            "WITH requested_ids AS (
               SELECT CAST(value AS INTEGER) AS rowId
                 FROM json_each(?)
             )
             DELETE FROM document_embedding_vector_rows
              WHERE id IN (SELECT rowId FROM requested_ids)",
          )
          .bind(&row_id_json)
          .execute(&mut *conn)
          .await?;
        }

        sqlx::query(
          "WITH requested AS (
             SELECT value AS vectorKey
               FROM json_each(?)
           )
           DELETE FROM document_embeddings
            WHERE vectorKey IN (SELECT vectorKey FROM requested)",
        )
        .bind(ids_json(&all_vector_keys))
        .execute(&mut *conn)
        .await?;

        Ok(())
      })
      .await
  })
  .await?;

  engine
    .with_conn(tx_id, async |conn| {
      for dimensions in dimension_keys {
        let table = vec_extension::vector_table_name(dimensions)?;
        if !has_vector_table(&mut *conn, &table).await? {
          continue;
        }
        let count = sqlx::query_as::<_, (i64,)>( &format!("SELECT COUNT(*) AS count FROM {table}"))
          .fetch_one(&mut *conn)
          .await?;
        if count.0 == 0 {
          sqlx::query(&format!("DROP TABLE IF EXISTS {table}"))
            .execute(&mut *conn)
            .await?;
        }
      }
      Ok(())
    })
    .await
}

pub async fn delete_embeddings_by_document_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
) -> StorageResult<()> {
  let references = list_vector_references_by_document_ids(engine, tx_id, &[document_id.to_string()])
    .await?;
  delete_vectors_by_references(engine, tx_id, &references).await
}
