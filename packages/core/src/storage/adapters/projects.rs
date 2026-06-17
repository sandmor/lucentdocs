use crate::storage::dto::{ProjectDto, UpdateProjectDataDto};
use crate::storage::engine::StorageEngine;
use crate::storage::error::StorageResult;
use crate::storage::json_util::ids_json;

#[derive(sqlx::FromRow)]
struct ProjectRow {
  id: String,
  title: String,
  #[sqlx(rename = "ownerUserId")]
  owner_user_id: String,
  metadata: Option<String>,
  #[sqlx(rename = "createdAt")]
  created_at: i64,
  #[sqlx(rename = "updatedAt")]
  updated_at: i64,
}

fn row_to_dto(row: ProjectRow) -> ProjectDto {
  ProjectDto {
    id: row.id,
    title: row.title,
    owner_user_id: row.owner_user_id,
    metadata_json: row.metadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

pub async fn find_all(engine: &StorageEngine, tx_id: Option<&str>) -> StorageResult<Vec<ProjectDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, ProjectRow>(
        "SELECT * FROM projects ORDER BY updatedAt DESC",
      )
      .fetch_all(&mut *conn)
      .await?;
      Ok(rows.into_iter().map(row_to_dto).collect())
    })
    .await
}

pub async fn find_by_owner_user_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  owner_user_id: &str,
) -> StorageResult<Vec<ProjectDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, ProjectRow>(
        "SELECT * FROM projects WHERE ownerUserId = ? ORDER BY updatedAt DESC",
      )
      .bind(owner_user_id)
      .fetch_all(&mut *conn)
      .await?;
      Ok(rows.into_iter().map(row_to_dto).collect())
    })
    .await
}

pub async fn find_by_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  id: &str,
) -> StorageResult<Option<ProjectDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let row = sqlx::query_as::<_, ProjectRow>("SELECT * FROM projects WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *conn)
        .await?;
      Ok(row.map(row_to_dto))
    })
    .await
}

pub async fn find_by_ids(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  ids: &[String],
) -> StorageResult<Vec<ProjectDto>> {
  let unique_ids: Vec<String> = ids
    .iter()
    .filter(|id| !id.is_empty())
    .cloned()
    .collect::<std::collections::HashSet<_>>()
    .into_iter()
    .collect();

  if unique_ids.is_empty() {
    return Ok(Vec::new());
  }

  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, ProjectRow>(
        "WITH requested AS (
           SELECT value AS id
             FROM json_each(?)
         )
         SELECT p.*
           FROM projects AS p
           JOIN requested ON requested.id = p.id",
      )
      .bind(ids_json(&unique_ids))
      .fetch_all(&mut *conn)
      .await?;
      Ok(rows.into_iter().map(row_to_dto).collect())
    })
    .await
}

pub async fn insert(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  project: &ProjectDto,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query(
        "INSERT INTO projects (id, title, ownerUserId, metadata, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(&project.id)
      .bind(&project.title)
      .bind(&project.owner_user_id)
      .bind(&project.metadata_json)
      .bind(project.created_at)
      .bind(project.updated_at)
      .execute(&mut *conn)
      .await?;
      Ok(())
    })
    .await
}

pub async fn update(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  id: &str,
  data: &UpdateProjectDataDto,
) -> StorageResult<()> {
  let has_title = data.title.is_some() as i32;
  let has_owner_user_id = data.owner_user_id.is_some() as i32;
  let has_metadata = data.metadata_json.is_some() as i32;

  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query(
        "UPDATE projects
         SET title = CASE WHEN ? = 1 THEN ? ELSE title END,
             ownerUserId = CASE WHEN ? = 1 THEN ? ELSE ownerUserId END,
             metadata = CASE WHEN ? = 1 THEN ? ELSE metadata END,
             updatedAt = ?
         WHERE id = ?",
      )
      .bind(has_title)
      .bind(data.title.as_deref())
      .bind(has_owner_user_id)
      .bind(data.owner_user_id.as_deref().unwrap_or(""))
      .bind(has_metadata)
      .bind(data.metadata_json.as_deref())
      .bind(data.updated_at)
      .bind(id)
      .execute(&mut *conn)
      .await?;
      Ok(())
    })
    .await
}

pub async fn delete_by_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  id: &str,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query("DELETE FROM projects WHERE id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
      Ok(())
    })
    .await
}
