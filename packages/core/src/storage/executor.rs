//! Shared query helpers for adapters.

use sqlx::SqliteConnection;

use crate::storage::error::StorageResult;

pub async fn run(conn: &mut SqliteConnection, sql: &str) -> StorageResult<()> {
  sqlx::query(sql).execute(conn).await?;
  Ok(())
}
