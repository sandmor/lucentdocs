use sqlx::SqliteConnection;

use crate::storage::adapters::with_transaction;
use crate::storage::dto::DocumentNoteDto;
use crate::storage::engine::StorageEngine;
use crate::storage::error::StorageResult;

#[derive(sqlx::FromRow)]
struct DocumentNoteRow {
  id: String,
  #[sqlx(rename = "documentId")]
  document_id: String,
  #[sqlx(rename = "anchorKind")]
  anchor_kind: String,
  #[sqlx(rename = "anchorId")]
  anchor_id: String,
  content: String,
  #[sqlx(rename = "authorUserId")]
  author_user_id: String,
  #[sqlx(rename = "createdAt")]
  created_at: i64,
  #[sqlx(rename = "updatedAt")]
  updated_at: i64,
}

fn row_to_dto(row: DocumentNoteRow) -> DocumentNoteDto {
  DocumentNoteDto {
    id: row.id,
    document_id: row.document_id,
    anchor_kind: row.anchor_kind,
    anchor_id: row.anchor_id,
    content: row.content,
    author_user_id: row.author_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

pub async fn list_by_document_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
) -> StorageResult<Vec<DocumentNoteDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, DocumentNoteRow>(
        "SELECT id, documentId, anchorKind, anchorId, content, authorUserId, createdAt, updatedAt
           FROM document_notes
          WHERE documentId = ?
          ORDER BY createdAt ASC",
      )
      .bind(document_id)
      .fetch_all(&mut *conn)
      .await?;
      Ok(rows.into_iter().map(row_to_dto).collect())
    })
    .await
}

async fn replace_all_for_document_conn(
  conn: &mut SqliteConnection,
  document_id: &str,
  notes: &[DocumentNoteDto],
) -> StorageResult<()> {
  sqlx::query("DELETE FROM document_notes WHERE documentId = ?")
    .bind(document_id)
    .execute(&mut *conn)
    .await?;

  for note in notes {
    sqlx::query(
      "INSERT INTO document_notes (
         id, documentId, anchorKind, anchorId, content, authorUserId, createdAt, updatedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&note.id)
    .bind(document_id)
    .bind(&note.anchor_kind)
    .bind(&note.anchor_id)
    .bind(&note.content)
    .bind(&note.author_user_id)
    .bind(note.created_at)
    .bind(note.updated_at)
    .execute(&mut *conn)
    .await?;
  }

  Ok(())
}

pub async fn replace_all_for_document(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
  notes: &[DocumentNoteDto],
) -> StorageResult<()> {
  with_transaction(engine, tx_id, async |engine, tx| {
    engine
      .with_conn(Some(tx), async |conn| {
        replace_all_for_document_conn(&mut *conn, document_id, notes).await
      })
      .await
  })
  .await
}

pub async fn delete_by_document_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query("DELETE FROM document_notes WHERE documentId = ?")
        .bind(document_id)
        .execute(&mut *conn)
        .await?;
      Ok(())
    })
    .await
}
