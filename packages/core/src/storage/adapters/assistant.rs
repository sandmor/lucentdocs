use crate::storage::dto::{AssistantMessageDto, AssistantThreadDto, UpdateAssistantThreadDataDto};
use crate::storage::engine::StorageEngine;
use crate::storage::error::StorageResult;

#[derive(sqlx::FromRow)]
struct AssistantThreadRow {
  id: String,
  #[sqlx(rename = "projectId")]
  project_id: String,
  #[sqlx(rename = "createdByUserId")]
  created_by_user_id: String,
  title: String,
  mode: String,
  #[sqlx(rename = "selectedRootMessageId")]
  selected_root_message_id: Option<String>,
  revision: i64,
  #[sqlx(rename = "createdAt")]
  created_at: i64,
  #[sqlx(rename = "updatedAt")]
  updated_at: i64,
}

#[derive(sqlx::FromRow)]
struct AssistantMessageRow {
  id: String,
  #[sqlx(rename = "threadId")]
  thread_id: String,
  #[sqlx(rename = "parentId")]
  parent_id: Option<String>,
  role: String,
  #[sqlx(rename = "partsJson")]
  parts_json: String,
  #[sqlx(rename = "branchOrdinal")]
  branch_ordinal: i64,
  #[sqlx(rename = "selectedChildId")]
  selected_child_id: Option<String>,
  #[sqlx(rename = "createdAt")]
  created_at: i64,
  #[sqlx(rename = "updatedAt")]
  updated_at: i64,
}

#[derive(sqlx::FromRow)]
struct AssistantPreferenceRow {
  #[sqlx(rename = "scopeType")]
  scope_type: String,
  #[sqlx(rename = "scopeId")]
  scope_id: String,
  #[sqlx(rename = "overridesJson")]
  overrides_json: String,
  #[sqlx(rename = "updatedAt")]
  updated_at: i64,
}

fn thread_to_dto(row: AssistantThreadRow) -> AssistantThreadDto {
  AssistantThreadDto {
    id: row.id,
    project_id: row.project_id,
    created_by_user_id: row.created_by_user_id,
    title: row.title,
    mode: row.mode,
    selected_root_message_id: row.selected_root_message_id,
    revision: row.revision,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

fn message_to_dto(row: AssistantMessageRow) -> AssistantMessageDto {
  AssistantMessageDto {
    id: row.id,
    thread_id: row.thread_id,
    parent_id: row.parent_id,
    role: row.role,
    parts_json: row.parts_json,
    branch_ordinal: row.branch_ordinal,
    selected_child_id: row.selected_child_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

fn preference_to_dto(row: AssistantPreferenceRow) -> crate::storage::dto::AssistantPreferenceSettingDto {
  crate::storage::dto::AssistantPreferenceSettingDto { scope_type: row.scope_type, scope_id: row.scope_id, overrides_json: row.overrides_json, updated_at: row.updated_at }
}

const THREAD_FIELDS: &str = "id, projectId, createdByUserId, title, mode, selectedRootMessageId, revision, createdAt, updatedAt";
const MESSAGE_FIELDS: &str = "id, threadId, parentId, role, partsJson, branchOrdinal, selectedChildId, createdAt, updatedAt";

pub async fn find_thread(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  project_id: &str,
  id: &str,
) -> StorageResult<Option<AssistantThreadDto>> {
  engine.with_conn(tx_id, async |conn| {
    let sql = format!("SELECT {THREAD_FIELDS} FROM assistant_threads WHERE projectId = ? AND id = ?");
    let row = sqlx::query_as::<_, AssistantThreadRow>(&sql)
      .bind(project_id)
      .bind(id)
      .fetch_optional(&mut *conn)
      .await?;
    Ok(row.map(thread_to_dto))
  }).await
}

pub async fn list_threads(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  project_id: &str,
) -> StorageResult<Vec<AssistantThreadDto>> {
  engine.with_conn(tx_id, async |conn| {
    let sql = format!("SELECT {THREAD_FIELDS} FROM assistant_threads WHERE projectId = ? ORDER BY updatedAt DESC, createdAt DESC");
    let rows = sqlx::query_as::<_, AssistantThreadRow>(&sql)
      .bind(project_id)
      .fetch_all(&mut *conn)
      .await?;
    Ok(rows.into_iter().map(thread_to_dto).collect())
  }).await
}

pub async fn insert_thread(engine: &StorageEngine, tx_id: Option<&str>, row: &AssistantThreadDto) -> StorageResult<()> {
  engine.with_conn(tx_id, async |conn| {
    sqlx::query("INSERT INTO assistant_threads (id, projectId, createdByUserId, title, mode, selectedRootMessageId, revision, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(&row.id).bind(&row.project_id).bind(&row.created_by_user_id).bind(&row.title)
      .bind(&row.mode).bind(&row.selected_root_message_id).bind(row.revision)
      .bind(row.created_at).bind(row.updated_at).execute(&mut *conn).await?;
    Ok(())
  }).await
}

pub async fn update_thread(engine: &StorageEngine, tx_id: Option<&str>, project_id: &str, id: &str, data: &UpdateAssistantThreadDataDto) -> StorageResult<bool> {
  engine.with_conn(tx_id, async |conn| {
    let result = sqlx::query("UPDATE assistant_threads SET title = COALESCE(?, title), mode = COALESCE(?, mode), selectedRootMessageId = ?, revision = ?, updatedAt = ? WHERE projectId = ? AND id = ?")
      .bind(&data.title).bind(&data.mode).bind(&data.selected_root_message_id).bind(data.revision).bind(data.updated_at)
      .bind(project_id).bind(id).execute(&mut *conn).await?;
    Ok(result.rows_affected() > 0)
  }).await
}

pub async fn delete_thread(engine: &StorageEngine, tx_id: Option<&str>, project_id: &str, id: &str) -> StorageResult<bool> {
  engine.with_conn(tx_id, async |conn| {
    let result = sqlx::query("DELETE FROM assistant_threads WHERE projectId = ? AND id = ?")
      .bind(project_id).bind(id).execute(&mut *conn).await?;
    Ok(result.rows_affected() > 0)
  }).await
}

pub async fn list_messages(engine: &StorageEngine, tx_id: Option<&str>, thread_id: &str) -> StorageResult<Vec<AssistantMessageDto>> {
  engine.with_conn(tx_id, async |conn| {
    let sql = format!("SELECT {MESSAGE_FIELDS} FROM assistant_messages WHERE threadId = ? ORDER BY createdAt ASC, branchOrdinal ASC");
    let rows = sqlx::query_as::<_, AssistantMessageRow>(&sql).bind(thread_id).fetch_all(&mut *conn).await?;
    Ok(rows.into_iter().map(message_to_dto).collect())
  }).await
}

pub async fn replace_messages(engine: &StorageEngine, tx_id: Option<&str>, thread_id: &str, messages: &[AssistantMessageDto]) -> StorageResult<()> {
  engine.with_conn(tx_id, async |conn| {
    sqlx::query("DELETE FROM assistant_messages WHERE threadId = ?").bind(thread_id).execute(&mut *conn).await?;
    for message in messages {
      sqlx::query("INSERT INTO assistant_messages (id, threadId, parentId, role, partsJson, branchOrdinal, selectedChildId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(&message.id).bind(&message.thread_id).bind(&message.parent_id).bind(&message.role)
        .bind(&message.parts_json).bind(message.branch_ordinal).bind(&message.selected_child_id)
        .bind(message.created_at).bind(message.updated_at).execute(&mut *conn).await?;
    }
    Ok(())
  }).await
}

pub async fn get_preference(engine: &StorageEngine, tx_id: Option<&str>, scope_type: &str, scope_id: &str) -> StorageResult<Option<crate::storage::dto::AssistantPreferenceSettingDto>> {
  engine.with_conn(tx_id, async |conn| {
    let row = sqlx::query_as::<_, AssistantPreferenceRow>("SELECT scopeType, scopeId, overridesJson, updatedAt FROM assistant_preference_settings WHERE scopeType = ? AND scopeId = ?")
      .bind(scope_type).bind(scope_id).fetch_optional(&mut *conn).await?;
    Ok(row.map(preference_to_dto))
  }).await
}

pub async fn upsert_preference(engine: &StorageEngine, tx_id: Option<&str>, input: &crate::storage::dto::AssistantPreferenceSettingDto) -> StorageResult<()> {
  engine.with_conn(tx_id, async |conn| {
    sqlx::query("INSERT INTO assistant_preference_settings (scopeType, scopeId, overridesJson, updatedAt) VALUES (?, ?, ?, ?) ON CONFLICT(scopeType, scopeId) DO UPDATE SET overridesJson = excluded.overridesJson, updatedAt = excluded.updatedAt")
      .bind(&input.scope_type).bind(&input.scope_id).bind(&input.overrides_json).bind(input.updated_at).execute(&mut *conn).await?;
    Ok(())
  }).await
}
