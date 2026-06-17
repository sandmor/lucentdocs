use crate::storage::dto::{VersionSnapshotCursorDto, VersionSnapshotDto, VersionSnapshotMetaDto};
use crate::storage::engine::StorageEngine;
use crate::storage::error::StorageResult;

#[derive(sqlx::FromRow)]
struct VersionSnapshotRow {
  id: String,
  #[sqlx(rename = "documentId")]
  document_id: String,
  content: String,
  #[sqlx(rename = "createdAt")]
  created_at: i64,
}

#[derive(sqlx::FromRow)]
struct VersionSnapshotMetaRow {
  id: String,
  #[sqlx(rename = "documentId")]
  document_id: String,
  #[sqlx(rename = "createdAt")]
  created_at: i64,
}

#[derive(sqlx::FromRow)]
struct VersionSnapshotCursorRow {
  id: String,
  #[sqlx(rename = "documentId")]
  document_id: String,
  content: String,
  #[sqlx(rename = "createdAt")]
  created_at: i64,
  #[sqlx(rename = "rowId")]
  row_id: i64,
}

fn row_to_dto(row: VersionSnapshotRow) -> VersionSnapshotDto {
  VersionSnapshotDto {
    id: row.id,
    document_id: row.document_id,
    content: row.content,
    created_at: row.created_at,
  }
}

pub async fn find_by_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  id: &str,
) -> StorageResult<Option<VersionSnapshotDto>> {
  engine
    .with_conn(tx_id, async |conn| {
        let row = sqlx::query_as::<_, VersionSnapshotRow>(
          "SELECT * FROM version_snapshots WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&mut *conn)
        .await?;
        Ok(row.map(row_to_dto))
    })
    .await
}

pub async fn find_metadata_by_document_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
) -> StorageResult<Vec<VersionSnapshotMetaDto>> {
  engine
    .with_conn(tx_id, async |conn| {
        let rows = sqlx::query_as::<_, VersionSnapshotMetaRow>(
          "SELECT id, documentId, createdAt
             FROM version_snapshots
            WHERE documentId = ?
            ORDER BY createdAt DESC",
        )
        .bind(document_id)
        .fetch_all(&mut *conn)
        .await?;
        Ok(rows
          .into_iter()
          .map(|row| VersionSnapshotMetaDto {
            id: row.id,
            document_id: row.document_id,
            created_at: row.created_at,
          })
          .collect())
    })
    .await
}

pub async fn find_cursor_by_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
  id: &str,
) -> StorageResult<Option<VersionSnapshotCursorDto>> {
  engine
    .with_conn(tx_id, async |conn| {
        let row = sqlx::query_as::<_, VersionSnapshotCursorRow>(
          "SELECT id, documentId, content, createdAt, rowid AS rowId
             FROM version_snapshots
            WHERE id = ? AND documentId = ?",
        )
        .bind(id)
        .bind(document_id)
        .fetch_optional(&mut *conn)
        .await?;
        Ok(row.map(|row| VersionSnapshotCursorDto {
          id: row.id,
          document_id: row.document_id,
          content: row.content,
          created_at: row.created_at,
          row_id: row.row_id,
        }))
    })
    .await
}

pub async fn insert(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  snapshot: &VersionSnapshotDto,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
        sqlx::query(
          "INSERT INTO version_snapshots (id, documentId, content, createdAt)
           VALUES (?, ?, ?, ?)",
        )
        .bind(&snapshot.id)
        .bind(&snapshot.document_id)
        .bind(&snapshot.content)
        .bind(snapshot.created_at)
        .execute(&mut *conn)
        .await?;
        Ok(())
    })
    .await
}

pub async fn delete_snapshots_after_cursor(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
  cursor_created_at: i64,
  cursor_row_id: i64,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
        sqlx::query(
          "DELETE FROM version_snapshots
           WHERE documentId = ?
             AND (
               createdAt > ?
               OR (createdAt = ? AND rowid > ?)
             )",
        )
        .bind(document_id)
        .bind(cursor_created_at)
        .bind(cursor_created_at)
        .bind(cursor_row_id)
        .execute(&mut *conn)
        .await?;
        Ok(())
    })
    .await
}
