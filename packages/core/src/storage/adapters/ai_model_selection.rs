use crate::storage::dto::{AiModelSelectionDto, UpsertAiModelSelectionDto};
use crate::storage::engine::StorageEngine;
use crate::storage::error::{StorageError, StorageResult};
use crate::storage::json_util::ids_json;

#[derive(sqlx::FromRow)]
struct AiModelSelectionRow {
  usage: String,
  #[sqlx(rename = "scopeType")]
  scope_type: String,
  #[sqlx(rename = "scopeId")]
  scope_id: String,
  #[sqlx(rename = "providerConfigId")]
  provider_config_id: String,
  #[sqlx(rename = "updatedAt")]
  updated_at: i64,
}

fn row_to_dto(row: AiModelSelectionRow) -> AiModelSelectionDto {
  AiModelSelectionDto {
    usage: row.usage,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    provider_config_id: row.provider_config_id,
    updated_at: row.updated_at,
  }
}

pub async fn get(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  usage: &str,
  scope_type: &str,
  scope_id: &str,
) -> StorageResult<Option<AiModelSelectionDto>> {
  engine
    .with_conn(tx_id, async |conn| {
        let row = sqlx::query_as::<_, AiModelSelectionRow>(
          "SELECT usage, scopeType, scopeId, providerConfigId, updatedAt
             FROM ai_model_selection_settings
            WHERE usage = ? AND scopeType = ? AND scopeId = ?",
        )
        .bind(usage)
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
  usage: &str,
  scope_type: &str,
  scope_ids: &[String],
) -> StorageResult<Vec<AiModelSelectionDto>> {
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
        let rows = sqlx::query_as::<_, AiModelSelectionRow>(
          "WITH requested AS (
             SELECT value AS scopeId
               FROM json_each(?)
           )
           SELECT s.usage, s.scopeType, s.scopeId, s.providerConfigId, s.updatedAt
             FROM ai_model_selection_settings AS s
             JOIN requested ON requested.scopeId = s.scopeId
            WHERE s.usage = ? AND s.scopeType = ?",
        )
        .bind(ids_json(&unique_scope_ids))
        .bind(usage)
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
  input: &UpsertAiModelSelectionDto,
) -> StorageResult<AiModelSelectionDto> {
  engine
    .with_conn(tx_id, async |conn| {
        sqlx::query(
          "INSERT INTO ai_model_selection_settings
             (usage, scopeType, scopeId, providerConfigId, updatedAt)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(usage, scopeType, scopeId) DO UPDATE SET
             providerConfigId = excluded.providerConfigId,
             updatedAt = excluded.updatedAt",
        )
        .bind(&input.usage)
        .bind(&input.scope_type)
        .bind(&input.scope_id)
        .bind(&input.provider_config_id)
        .bind(input.updated_at)
        .execute(&mut *conn)
        .await?;
        Ok(())
    })
    .await?;

  get(
    engine,
    tx_id,
    &input.usage,
    &input.scope_type,
    &input.scope_id,
  )
  .await?
  .ok_or_else(|| StorageError::new("Failed to read stored AI model selection settings."))
}

pub async fn delete(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  usage: &str,
  scope_type: &str,
  scope_id: &str,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
        sqlx::query(
          "DELETE FROM ai_model_selection_settings WHERE usage = ? AND scopeType = ? AND scopeId = ?",
        )
        .bind(usage)
        .bind(scope_type)
        .bind(scope_id)
        .execute(&mut *conn)
        .await?;
        Ok(())
    })
    .await
}
