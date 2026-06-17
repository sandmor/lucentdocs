use crate::storage::dto::{IndexingSettingsDto, UpsertIndexingSettingsDto};
use crate::storage::engine::StorageEngine;
use crate::storage::error::{StorageError, StorageResult};
use crate::storage::json_util::ids_json;

#[derive(sqlx::FromRow)]
struct IndexingSettingsRow {
  #[sqlx(rename = "scopeType")]
  scope_type: String,
  #[sqlx(rename = "scopeId")]
  scope_id: String,
  #[sqlx(rename = "strategyType")]
  strategy_type: String,
  #[sqlx(rename = "strategyProperties")]
  strategy_properties_json: String,
  #[sqlx(rename = "updatedAt")]
  updated_at: i64,
}

fn row_to_dto(row: IndexingSettingsRow) -> IndexingSettingsDto {
  IndexingSettingsDto {
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    strategy_type: row.strategy_type,
    strategy_properties_json: row.strategy_properties_json,
    updated_at: row.updated_at,
  }
}

pub async fn get(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  scope_type: &str,
  scope_id: &str,
) -> StorageResult<Option<IndexingSettingsDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let row = sqlx::query_as::<_, IndexingSettingsRow>(
        "SELECT scopeType, scopeId, strategyType, strategyProperties, updatedAt
           FROM indexing_strategy_settings
          WHERE scopeType = ? AND scopeId = ?",
      )
      .bind(scope_type)
      .bind(scope_id)
      .fetch_optional(&mut *conn)
      .await?;
      Ok(row.map(row_to_dto))
    })
    .await
}

pub async fn get_many(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  scope_type: &str,
  scope_ids: &[String],
) -> StorageResult<Vec<IndexingSettingsDto>> {
  let unique_scope_ids: Vec<String> = scope_ids
    .iter()
    .filter(|id| !id.is_empty())
    .cloned()
    .collect::<std::collections::HashSet<_>>()
    .into_iter()
    .collect();

  if unique_scope_ids.is_empty() {
    return Ok(Vec::new());
  }

  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, IndexingSettingsRow>(
        "WITH requested AS (
           SELECT value AS scopeId
             FROM json_each(?)
         )
         SELECT s.scopeType, s.scopeId, s.strategyType, s.strategyProperties, s.updatedAt
           FROM indexing_strategy_settings AS s
           JOIN requested ON requested.scopeId = s.scopeId
          WHERE s.scopeType = ?",
      )
      .bind(ids_json(&unique_scope_ids))
      .bind(scope_type)
      .fetch_all(&mut *conn)
      .await?;
      Ok(rows.into_iter().map(row_to_dto).collect())
    })
    .await
}

pub async fn upsert(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  input: &UpsertIndexingSettingsDto,
) -> StorageResult<IndexingSettingsDto> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query(
        "INSERT INTO indexing_strategy_settings
           (scopeType, scopeId, strategyType, strategyProperties, updatedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(scopeType, scopeId) DO UPDATE SET
           strategyType = excluded.strategyType,
           strategyProperties = excluded.strategyProperties,
           updatedAt = excluded.updatedAt",
      )
      .bind(&input.scope_type)
      .bind(&input.scope_id)
      .bind(&input.strategy_type)
      .bind(&input.strategy_properties_json)
      .bind(input.updated_at)
      .execute(&mut *conn)
      .await?;
      Ok(())
    })
    .await?;

  get(engine, tx_id, &input.scope_type, &input.scope_id)
    .await?
    .ok_or_else(|| StorageError::new("Failed to read stored indexing settings."))
}

pub async fn delete(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  scope_type: &str,
  scope_id: &str,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query(
        "DELETE FROM indexing_strategy_settings WHERE scopeType = ? AND scopeId = ?",
      )
      .bind(scope_type)
      .bind(scope_id)
      .execute(&mut *conn)
      .await?;
      Ok(())
    })
    .await
}
