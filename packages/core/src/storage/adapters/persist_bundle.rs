use crate::storage::adapters::with_transaction;
use crate::storage::dto::{DocumentNoteDto, PersistBundleInputDto};
use crate::storage::engine::StorageEngine;
use crate::storage::error::StorageResult;

#[derive(serde::Deserialize)]
struct PersistNoteJson {
  id: String,
  document_id: String,
  block_id: String,
  placement: String,
  content: String,
  author_user_id: String,
  created_at: i64,
  updated_at: i64,
}

impl From<PersistNoteJson> for DocumentNoteDto {
  fn from(note: PersistNoteJson) -> Self {
    Self {
      id: note.id,
      document_id: note.document_id,
      block_id: note.block_id,
      placement: note.placement,
      content: note.content,
      author_user_id: note.author_user_id,
      created_at: note.created_at,
      updated_at: note.updated_at,
    }
  }
}

pub async fn persist(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  input: &PersistBundleInputDto,
) -> StorageResult<()> {
  let parsed_notes: Vec<PersistNoteJson> = serde_json::from_str(&input.notes_json)?;
  let notes: Vec<DocumentNoteDto> = parsed_notes.into_iter().map(DocumentNoteDto::from).collect();
  let document_id = input.document_id.clone();
  let yjs_data = input.yjs_data.to_vec();
  let content_json = input.content_json.clone();
  let content_updated_at = input.content_updated_at;
  let snapshot_id = input.snapshot_id.clone();
  let snapshot_content_json = input.snapshot_content_json.clone();
  let snapshot_created_at = input.snapshot_created_at;

  with_transaction(engine, tx_id, async |engine, tx| {
    engine
      .with_conn(Some(tx), async |conn| {
        sqlx::query(
          "INSERT INTO yjs_documents (name, data) VALUES (?, ?)
           ON CONFLICT(name) DO UPDATE SET data = excluded.data",
        )
        .bind(&document_id)
        .bind(&yjs_data)
        .execute(&mut *conn)
        .await?;

        sqlx::query(
          "INSERT INTO document_content (documentId, content, updatedAt)
           VALUES (?, ?, ?)
           ON CONFLICT(documentId) DO UPDATE SET
             content = excluded.content,
             updatedAt = excluded.updatedAt",
        )
        .bind(&document_id)
        .bind(&content_json)
        .bind(content_updated_at)
        .execute(&mut *conn)
        .await?;

        sqlx::query("DELETE FROM document_notes WHERE documentId = ?")
          .bind(&document_id)
          .execute(&mut *conn)
          .await?;

        for note in &notes {
          sqlx::query(
            "INSERT INTO document_notes (
               id, documentId, blockId, placement, content, authorUserId, createdAt, updatedAt
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(&note.id)
          .bind(&document_id)
          .bind(&note.block_id)
          .bind(&note.placement)
          .bind(&note.content)
          .bind(&note.author_user_id)
          .bind(note.created_at)
          .bind(note.updated_at)
          .execute(&mut *conn)
          .await?;
        }

        if let (Some(snapshot_id), Some(snapshot_content), Some(snapshot_created_at)) = (
          snapshot_id,
          snapshot_content_json,
          snapshot_created_at,
        ) {
          sqlx::query(
            "INSERT INTO version_snapshots (id, documentId, content, createdAt)
             VALUES (?, ?, ?, ?)",
          )
          .bind(snapshot_id)
          .bind(&document_id)
          .bind(snapshot_content)
          .bind(snapshot_created_at)
          .execute(&mut *conn)
          .await?;
        }

        Ok(())
      })
      .await
  })
  .await
}
