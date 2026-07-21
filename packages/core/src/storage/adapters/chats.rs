use crate::storage::dto::ChatThreadDto;
use crate::storage::engine::StorageEngine;
use crate::storage::error::StorageResult;

#[derive(sqlx::FromRow)]
struct ChatThreadRow {
  id: String,
  #[sqlx(rename = "projectId")]
  project_id: String,
  #[sqlx(rename = "documentId")]
  document_id: String,
  title: String,
  messages: String,
  #[sqlx(rename = "createdAt")]
  created_at: i64,
  #[sqlx(rename = "updatedAt")]
  updated_at: i64,
}

fn row_to_dto(row: ChatThreadRow) -> ChatThreadDto {
  ChatThreadDto {
    id: row.id,
    project_id: row.project_id,
    document_id: row.document_id,
    title: row.title,
    messages: row.messages,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

pub async fn find_by_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  project_id: &str,
  document_id: &str,
  id: &str,
) -> StorageResult<Option<ChatThreadDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let row = sqlx::query_as::<_, ChatThreadRow>(
        "SELECT id, projectId, documentId, title, messages, createdAt, updatedAt
           FROM chat_threads
          WHERE projectId = ? AND documentId = ? AND id = ?",
      )
      .bind(project_id)
      .bind(document_id)
      .bind(id)
      .fetch_optional(&mut *conn)
      .await?;
      Ok(row.map(row_to_dto))
    })
    .await
}

pub async fn list_by_document(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  project_id: &str,
  document_id: &str,
) -> StorageResult<Vec<ChatThreadDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, ChatThreadRow>(
        "SELECT id, projectId, documentId, title, messages, createdAt, updatedAt
           FROM chat_threads
          WHERE projectId = ? AND documentId = ?
          ORDER BY updatedAt DESC, createdAt DESC",
      )
      .bind(project_id)
      .bind(document_id)
      .fetch_all(&mut *conn)
      .await?;
      Ok(rows.into_iter().map(row_to_dto).collect())
    })
    .await
}

pub async fn list_by_project(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  project_id: &str,
) -> StorageResult<Vec<ChatThreadDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, ChatThreadRow>(
        "SELECT id, projectId, documentId, title, messages, createdAt, updatedAt
           FROM chat_threads
          WHERE projectId = ?
          ORDER BY updatedAt DESC, createdAt DESC",
      )
      .bind(project_id)
      .fetch_all(&mut *conn)
      .await?;
      Ok(rows.into_iter().map(row_to_dto).collect())
    })
    .await
}

pub async fn insert(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  row: &ChatThreadDto,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query(
        "INSERT INTO chat_threads
           (id, projectId, documentId, title, messages, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(&row.id)
      .bind(&row.project_id)
      .bind(&row.document_id)
      .bind(&row.title)
      .bind(&row.messages)
      .bind(row.created_at)
      .bind(row.updated_at)
      .execute(&mut *conn)
      .await?;
      Ok(())
    })
    .await
}

pub async fn update(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  project_id: &str,
  document_id: &str,
  id: &str,
  data: &crate::storage::dto::UpdateChatThreadDataDto,
) -> StorageResult<bool> {
  let mut clauses = Vec::new();
  if data.title.is_some() {
    clauses.push("title = ?");
  }
  if data.messages.is_some() {
    clauses.push("messages = ?");
  }
  clauses.push("updatedAt = ?");

  let sql = format!(
    "UPDATE chat_threads SET {} WHERE projectId = ? AND documentId = ? AND id = ?",
    clauses.join(", ")
  );

  engine
    .with_conn(tx_id, async |conn| {
      let mut query = sqlx::query(&sql);
      if let Some(title) = &data.title {
        query = query.bind(title);
      }
      if let Some(messages) = &data.messages {
        query = query.bind(messages);
      }
      query = query
        .bind(data.updated_at)
        .bind(project_id)
        .bind(document_id)
        .bind(id);

      let result = query.execute(&mut *conn).await?;
      Ok(result.rows_affected() > 0)
    })
    .await
}

pub async fn delete_by_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  project_id: &str,
  document_id: &str,
  id: &str,
) -> StorageResult<bool> {
  engine
    .with_conn(tx_id, async |conn| {
      let result = sqlx::query(
        "DELETE FROM chat_threads WHERE projectId = ? AND documentId = ? AND id = ?",
      )
      .bind(project_id)
      .bind(document_id)
      .bind(id)
      .execute(&mut *conn)
      .await?;
      Ok(result.rows_affected() > 0)
    })
    .await
}
