use crate::storage::dto::AppConfigEntryDto;
use crate::storage::engine::StorageEngine;
use crate::storage::error::StorageResult;

#[derive(sqlx::FromRow)]
struct ConfigRow {
  key: String,
  value: String,
}

pub async fn is_empty(engine: &StorageEngine, tx_id: Option<&str>) -> StorageResult<bool> {
  engine
    .with_conn(tx_id, async |conn| {
      let row = sqlx::query_as::<_, (String,)>(
        "SELECT key FROM app_config_values LIMIT 1",
      )
      .fetch_optional(&mut *conn)
      .await?;
      Ok(row.is_none())
    })
    .await
}

pub async fn read_all(
  engine: &StorageEngine,
  tx_id: Option<&str>,
) -> StorageResult<Vec<AppConfigEntryDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, ConfigRow>("SELECT key, value FROM app_config_values")
        .fetch_all(&mut *conn)
        .await?;
      Ok(rows
        .into_iter()
        .map(|row| AppConfigEntryDto {
          key: row.key,
          value: row.value,
        })
        .collect())
    })
    .await
}

pub async fn upsert_many(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  entries: &[AppConfigEntryDto],
  updated_at: i64,
) -> StorageResult<()> {
  if entries.is_empty() {
    return Ok(());
  }

  crate::storage::adapters::with_transaction(engine, tx_id, async |engine, tx| {
    for entry in entries {
      engine
        .with_conn(Some(tx), async |conn| {
          sqlx::query(
            "INSERT INTO app_config_values (key, value, updatedAt)
             VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt",
          )
          .bind(&entry.key)
          .bind(&entry.value)
          .bind(updated_at)
          .execute(&mut *conn)
          .await?;
          Ok(())
      })
      .await?;
    }
    Ok(())
  })
  .await
}
