use crate::storage::dto::{
  AiApiKeyDto, AiProviderConfigDto, UpdateAiApiKeyDataDto, UpsertAiProviderConfigDto,
};
use crate::storage::engine::StorageEngine;
use crate::storage::error::StorageResult;
use crate::storage::json_util::ids_json;

#[derive(sqlx::FromRow)]
struct ProviderRow {
  id: String,
  usage: String,
  name: Option<String>,
  #[sqlx(rename = "providerId")]
  provider_id: String,
  r#type: String,
  #[sqlx(rename = "baseUrl")]
  base_url: String,
  model: String,
  #[sqlx(rename = "apiKeyId")]
  api_key_id: Option<String>,
  #[sqlx(rename = "customHeaders")]
  custom_headers_json: String,
  #[sqlx(rename = "sortOrder")]
  sort_order: i32,
  #[sqlx(rename = "createdAt")]
  created_at: i64,
  #[sqlx(rename = "updatedAt")]
  updated_at: i64,
}

#[derive(sqlx::FromRow)]
struct ApiKeyRow {
  id: String,
  #[sqlx(rename = "baseUrl")]
  base_url: String,
  name: String,
  #[sqlx(rename = "apiKey")]
  api_key: String,
  #[sqlx(rename = "isDefault")]
  is_default: i32,
  #[sqlx(rename = "createdAt")]
  created_at: i64,
  #[sqlx(rename = "updatedAt")]
  updated_at: i64,
}

fn provider_row_to_dto(row: ProviderRow) -> AiProviderConfigDto {
  AiProviderConfigDto {
    id: row.id,
    usage: row.usage,
    name: row.name,
    provider_id: row.provider_id,
    r#type: row.r#type,
    base_url: row.base_url,
    model: row.model,
    api_key_id: row.api_key_id,
    custom_headers_json: row.custom_headers_json,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

fn api_key_row_to_dto(row: ApiKeyRow) -> AiApiKeyDto {
  AiApiKeyDto {
    id: row.id,
    base_url: row.base_url,
    name: row.name,
    api_key: row.api_key,
    is_default: row.is_default != 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

pub async fn list_provider_configs(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  usage: &str,
) -> StorageResult<Vec<AiProviderConfigDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, ProviderRow>(
        "SELECT id, usage, name, providerId, type, baseUrl, model, apiKeyId, customHeaders,
                sortOrder, createdAt, updatedAt
           FROM ai_provider_configs
          WHERE usage = ?
          ORDER BY sortOrder ASC, createdAt ASC",
      )
      .bind(usage)
      .fetch_all(&mut *conn)
      .await?;
      Ok(rows.into_iter().map(provider_row_to_dto).collect())
    })
    .await
}

pub async fn upsert_provider_config(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  input: &UpsertAiProviderConfigDto,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query(
        "INSERT INTO ai_provider_configs
           (id, usage, name, providerId, type, baseUrl, model, apiKeyId, customHeaders, sortOrder, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           usage = excluded.usage,
           name = excluded.name,
           providerId = excluded.providerId,
           type = excluded.type,
           baseUrl = excluded.baseUrl,
           model = excluded.model,
           apiKeyId = excluded.apiKeyId,
           customHeaders = excluded.customHeaders,
           sortOrder = excluded.sortOrder,
           updatedAt = excluded.updatedAt",
      )
      .bind(&input.id)
      .bind(&input.usage)
      .bind(&input.name)
      .bind(&input.provider_id)
      .bind(&input.r#type)
      .bind(&input.base_url)
      .bind(&input.model)
      .bind(&input.api_key_id)
      .bind(&input.custom_headers_json)
      .bind(input.sort_order)
      .bind(input.created_at)
      .bind(input.updated_at)
      .execute(&mut *conn)
      .await?;
      Ok(())
    })
    .await
}

pub async fn delete_provider_configs_not_in(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  usage: &str,
  ids: &[String],
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      if ids.is_empty() {
        sqlx::query("DELETE FROM ai_provider_configs WHERE usage = ?")
          .bind(usage)
          .execute(&mut *conn)
          .await?;
      } else {
        sqlx::query(
          "DELETE FROM ai_provider_configs AS cfg
            WHERE cfg.usage = ?
              AND NOT EXISTS (
                SELECT 1
                  FROM json_each(?) AS requested
                 WHERE requested.value = cfg.id
              )",
        )
        .bind(usage)
        .bind(ids_json(ids))
        .execute(&mut *conn)
        .await?;
      }
      Ok(())
    })
    .await
}

pub async fn list_api_keys(
  engine: &StorageEngine,
  tx_id: Option<&str>,
) -> StorageResult<Vec<AiApiKeyDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, ApiKeyRow>(
        "SELECT id, baseUrl, name, apiKey, isDefault, createdAt, updatedAt
           FROM ai_api_keys
          ORDER BY baseUrl ASC, isDefault DESC, updatedAt DESC",
      )
      .fetch_all(&mut *conn)
      .await?;
      Ok(rows.into_iter().map(api_key_row_to_dto).collect())
    })
    .await
}

pub async fn find_api_key_by_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  id: &str,
) -> StorageResult<Option<AiApiKeyDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let row = sqlx::query_as::<_, ApiKeyRow>(
        "SELECT id, baseUrl, name, apiKey, isDefault, createdAt, updatedAt
           FROM ai_api_keys
          WHERE id = ?",
      )
      .bind(id)
      .fetch_optional(&mut *conn)
      .await?;
      Ok(row.map(api_key_row_to_dto))
    })
    .await
}

pub async fn clear_default_api_keys(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  base_url: &str,
  updated_at: i64,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query("UPDATE ai_api_keys SET isDefault = 0, updatedAt = ? WHERE baseUrl = ?")
        .bind(updated_at)
        .bind(base_url)
        .execute(&mut *conn)
        .await?;
      Ok(())
    })
    .await
}

pub async fn insert_api_key(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  api_key: &AiApiKeyDto,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query(
        "INSERT INTO ai_api_keys (id, baseUrl, name, apiKey, isDefault, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(&api_key.id)
      .bind(&api_key.base_url)
      .bind(&api_key.name)
      .bind(&api_key.api_key)
      .bind(if api_key.is_default { 1 } else { 0 })
      .bind(api_key.created_at)
      .bind(api_key.updated_at)
      .execute(&mut *conn)
      .await?;
      Ok(())
    })
    .await
}

pub async fn update_api_key(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  id: &str,
  data: &UpdateAiApiKeyDataDto,
) -> StorageResult<()> {
  let has_name = data.name.is_some() as i32;
  let has_api_key = data.api_key.is_some() as i32;

  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query(
        "UPDATE ai_api_keys
         SET name = CASE WHEN ? = 1 THEN ? ELSE name END,
             apiKey = CASE WHEN ? = 1 THEN ? ELSE apiKey END,
             updatedAt = ?
         WHERE id = ?",
      )
      .bind(has_name)
      .bind(data.name.as_deref())
      .bind(has_api_key)
      .bind(data.api_key.as_deref())
      .bind(data.updated_at)
      .bind(id)
      .execute(&mut *conn)
      .await?;
      Ok(())
    })
    .await
}

pub async fn set_api_key_default(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  id: &str,
  is_default: bool,
  updated_at: i64,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query("UPDATE ai_api_keys SET isDefault = ?, updatedAt = ? WHERE id = ?")
        .bind(if is_default { 1 } else { 0 })
        .bind(updated_at)
        .bind(id)
        .execute(&mut *conn)
        .await?;
      Ok(())
    })
    .await
}

pub async fn delete_api_key(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  id: &str,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query("DELETE FROM ai_api_keys WHERE id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
      Ok(())
    })
    .await
}

pub async fn clear_provider_api_key_references(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  api_key_id: &str,
  updated_at: i64,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query(
        "UPDATE ai_provider_configs SET apiKeyId = NULL, updatedAt = ? WHERE apiKeyId = ?",
      )
      .bind(updated_at)
      .bind(api_key_id)
      .execute(&mut *conn)
      .await?;
      Ok(())
    })
    .await
}
