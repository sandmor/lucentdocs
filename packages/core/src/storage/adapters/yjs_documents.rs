use crate::storage::engine::StorageEngine;
use crate::storage::error::StorageResult;

pub async fn get_persisted(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
) -> StorageResult<Option<Vec<u8>>> {
  engine
    .with_conn(tx_id, async |conn| {
      let row = sqlx::query_as::<_, (Vec<u8>,)>(
        "SELECT data FROM yjs_documents WHERE name = ?",
      )
      .bind(document_id)
      .fetch_optional(&mut *conn)
      .await?;
      Ok(row.map(|(data,)| data))
    })
    .await
}

pub async fn set(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
  data: &[u8],
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query(
        "INSERT INTO yjs_documents (name, data) VALUES (?, ?)
         ON CONFLICT(name) DO UPDATE SET data = excluded.data",
      )
      .bind(document_id)
      .bind(data)
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
      sqlx::query("DELETE FROM yjs_documents WHERE name = ?")
        .bind(document_id)
        .execute(&mut *conn)
        .await?;
      Ok(())
    })
    .await
}
