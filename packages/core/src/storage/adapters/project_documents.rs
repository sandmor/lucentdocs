use std::collections::{HashMap, HashSet};

use crate::storage::dto::ProjectDocumentDto;
use crate::storage::engine::StorageEngine;
use crate::storage::error::StorageResult;
use crate::storage::json_util::ids_json;

pub async fn insert(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  row: &ProjectDocumentDto,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query(
        "INSERT INTO project_documents (projectId, documentId, addedAt) VALUES (?, ?, ?)",
      )
      .bind(&row.project_id)
      .bind(&row.document_id)
      .bind(row.added_at)
      .execute(&mut *conn)
      .await?;
      Ok(())
    })
    .await
}

pub async fn has_project_document(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  project_id: &str,
  document_id: &str,
) -> StorageResult<bool> {
  engine
    .with_conn(tx_id, async |conn| {
      let row = sqlx::query_as::<_, (i32,)>(
        "SELECT 1 AS found
           FROM project_documents
          WHERE projectId = ? AND documentId = ?
          LIMIT 1",
      )
      .bind(project_id)
      .bind(document_id)
      .fetch_optional(&mut *conn)
      .await?;
      Ok(row.is_some())
    })
    .await
}

pub async fn find_associated_document_ids(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  project_id: &str,
  document_ids: &[String],
) -> StorageResult<Vec<String>> {
  let unique_document_ids: Vec<String> = document_ids
    .iter()
    .filter(|id| !id.is_empty())
    .cloned()
    .collect::<HashSet<_>>()
    .into_iter()
    .collect();

  if project_id.is_empty() || unique_document_ids.is_empty() {
    return Ok(Vec::new());
  }

  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, (String,)>(
        "WITH requested AS (
           SELECT value AS documentId
             FROM json_each(?)
         )
         SELECT DISTINCT pd.documentId
           FROM project_documents AS pd
           JOIN requested ON requested.documentId = pd.documentId
          WHERE pd.projectId = ?",
      )
      .bind(ids_json(&unique_document_ids))
      .bind(project_id)
      .fetch_all(&mut *conn)
      .await?;
      Ok(rows.into_iter().map(|(id,)| id).collect())
    })
    .await
}

pub async fn list_document_ids(
  engine: &StorageEngine,
  tx_id: Option<&str>,
) -> StorageResult<Vec<String>> {
  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, (String,)>(
        "SELECT DISTINCT documentId
           FROM project_documents
          ORDER BY documentId ASC",
      )
      .fetch_all(&mut *conn)
      .await?;
      Ok(rows.into_iter().map(|(id,)| id).collect())
    })
    .await
}

pub async fn find_sole_document_ids_by_project_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  project_id: &str,
) -> StorageResult<Vec<String>> {
  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, (String,)>(
        "SELECT pd.documentId
           FROM project_documents pd
          WHERE pd.projectId = ?
            AND NOT EXISTS (
              SELECT 1
                FROM project_documents other
               WHERE other.documentId = pd.documentId
                 AND other.projectId <> ?
            )
          GROUP BY pd.documentId
          ORDER BY MAX(pd.addedAt) DESC",
      )
      .bind(project_id)
      .bind(project_id)
      .fetch_all(&mut *conn)
      .await?;
      Ok(rows.into_iter().map(|(id,)| id).collect())
    })
    .await
}

pub async fn find_project_ids_by_document_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
) -> StorageResult<Vec<String>> {
  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, (String,)>(
        "SELECT DISTINCT projectId
           FROM project_documents
          WHERE documentId = ?
          ORDER BY addedAt DESC",
      )
      .bind(document_id)
      .fetch_all(&mut *conn)
      .await?;
      Ok(rows.into_iter().map(|(id,)| id).collect())
    })
    .await
}

pub async fn find_sole_project_id_by_document_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
) -> StorageResult<Option<String>> {
  engine
    .with_conn(tx_id, async |conn| {
      let row = sqlx::query_as::<_, (String,)>(
        "SELECT MIN(projectId) AS projectId
           FROM project_documents
          WHERE documentId = ?
          GROUP BY documentId
          HAVING COUNT(DISTINCT projectId) = 1",
      )
      .bind(document_id)
      .fetch_optional(&mut *conn)
      .await?;
      Ok(row.map(|(id,)| id))
    })
    .await
}

pub async fn find_sole_project_ids_by_document_ids(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_ids: &[String],
) -> StorageResult<HashMap<String, String>> {
  let unique_document_ids: Vec<String> = document_ids
    .iter()
    .filter(|id| !id.is_empty())
    .cloned()
    .collect::<HashSet<_>>()
    .into_iter()
    .collect();

  if unique_document_ids.is_empty() {
    return Ok(HashMap::new());
  }

  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, (String, String)>(
        "WITH requested AS (
           SELECT value AS documentId
             FROM json_each(?)
         )
         SELECT pd.documentId, MIN(pd.projectId) AS projectId
           FROM project_documents AS pd
           JOIN requested ON requested.documentId = pd.documentId
          GROUP BY pd.documentId
         HAVING COUNT(DISTINCT pd.projectId) = 1",
      )
      .bind(ids_json(&unique_document_ids))
      .fetch_all(&mut *conn)
      .await?;
      Ok(rows.into_iter().collect())
    })
    .await
}
