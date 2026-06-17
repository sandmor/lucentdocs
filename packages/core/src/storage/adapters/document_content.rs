use crate::storage::dto::DocumentContentDto;
use crate::storage::engine::StorageEngine;
use crate::storage::error::StorageResult;

#[derive(sqlx::FromRow)]
struct DocumentContentRow {
  #[sqlx(rename = "documentId")]
  document_id: String,
  content: String,
  #[sqlx(rename = "updatedAt")]
  updated_at: i64,
}

pub async fn find_by_document_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
) -> StorageResult<Option<DocumentContentDto>> {
  engine
    .with_conn(tx_id, async |conn| {
        let row = sqlx::query_as::<_, DocumentContentRow>(
          "SELECT documentId, content, updatedAt FROM document_content WHERE documentId = ?",
        )
        .bind(document_id)
        .fetch_optional(&mut *conn)
        .await?;
        Ok(row.map(|row| DocumentContentDto {
          document_id: row.document_id,
          content: row.content,
          updated_at: row.updated_at,
        }))
    })
    .await
}

pub async fn upsert(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
  content_json: &str,
  updated_at: i64,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
        sqlx::query(
          "INSERT INTO document_content (documentId, content, updatedAt)
           VALUES (?, ?, ?)
           ON CONFLICT(documentId) DO UPDATE SET
             content = excluded.content,
             updatedAt = excluded.updatedAt",
        )
        .bind(document_id)
        .bind(content_json)
        .bind(updated_at)
        .execute(&mut *conn)
        .await?;
        Ok(())
    })
    .await
}

pub async fn delete(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
        sqlx::query("DELETE FROM document_content WHERE documentId = ?")
          .bind(document_id)
          .execute(&mut *conn)
          .await?;
        Ok(())
    })
    .await
}
