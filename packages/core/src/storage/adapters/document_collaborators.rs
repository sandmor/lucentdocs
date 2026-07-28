use crate::storage::dto::{DocumentCollaboratorDto, DocumentShareInvitationDto};
use crate::storage::engine::StorageEngine;
use crate::storage::error::StorageResult;

pub async fn list_for_document(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
) -> StorageResult<Vec<DocumentCollaboratorDto>> {
  engine.with_conn(tx_id, async |conn| {
    sqlx::query_as::<_, DocumentCollaboratorDto>(
      "SELECT documentId AS document_id, userId AS user_id, role,
              grantedByUserId AS granted_by_user_id, grantSource AS grant_source,
              createdAt AS created_at, updatedAt AS updated_at
         FROM document_collaborators WHERE documentId = ? ORDER BY createdAt ASC",
    )
    .bind(document_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(Into::into)
  }).await
}

pub async fn list_for_user(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  user_id: &str,
) -> StorageResult<Vec<DocumentCollaboratorDto>> {
  engine.with_conn(tx_id, async |conn| {
    sqlx::query_as::<_, DocumentCollaboratorDto>(
      "SELECT documentId AS document_id, userId AS user_id, role,
              grantedByUserId AS granted_by_user_id, grantSource AS grant_source,
              createdAt AS created_at, updatedAt AS updated_at
         FROM document_collaborators WHERE userId = ? ORDER BY updatedAt DESC",
    )
    .bind(user_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(Into::into)
  }).await
}

pub async fn find(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
  user_id: &str,
) -> StorageResult<Option<DocumentCollaboratorDto>> {
  engine.with_conn(tx_id, async |conn| {
    sqlx::query_as::<_, DocumentCollaboratorDto>(
      "SELECT documentId AS document_id, userId AS user_id, role,
              grantedByUserId AS granted_by_user_id, grantSource AS grant_source,
              createdAt AS created_at, updatedAt AS updated_at
         FROM document_collaborators WHERE documentId = ? AND userId = ?",
    )
    .bind(document_id)
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(Into::into)
  }).await
}

pub async fn upsert(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  row: &DocumentCollaboratorDto,
) -> StorageResult<()> {
  engine.with_conn(tx_id, async |conn| {
    sqlx::query(
      "INSERT INTO document_collaborators
        (documentId, userId, role, grantedByUserId, grantSource, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(documentId, userId) DO UPDATE SET
         role = excluded.role, grantedByUserId = excluded.grantedByUserId,
         grantSource = excluded.grantSource, updatedAt = excluded.updatedAt",
    )
    .bind(&row.document_id).bind(&row.user_id).bind(&row.role)
    .bind(&row.granted_by_user_id).bind(&row.grant_source)
    .bind(row.created_at).bind(row.updated_at)
    .execute(&mut *conn).await?;
    Ok(())
  }).await
}

pub async fn delete(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  document_id: &str,
  user_id: &str,
) -> StorageResult<()> {
  engine.with_conn(tx_id, async |conn| {
    sqlx::query("DELETE FROM document_collaborators WHERE documentId = ? AND userId = ?")
      .bind(document_id).bind(user_id).execute(&mut *conn).await?;
    Ok(())
  }).await
}

pub async fn insert_invitation(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  row: &DocumentShareInvitationDto,
) -> StorageResult<()> {
  engine.with_conn(tx_id, async |conn| {
    sqlx::query("INSERT INTO document_share_invitations
      (id, documentId, recipientUserId, role, invitedByUserId, createdAt, acceptedAt, declinedAt, revokedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(&row.id).bind(&row.document_id).bind(&row.recipient_user_id)
      .bind(&row.role).bind(&row.invited_by_user_id).bind(row.created_at)
      .bind(row.accepted_at).bind(row.declined_at).bind(row.revoked_at)
      .execute(&mut *conn).await?;
    Ok(())
  }).await
}

pub async fn list_invitations_for_user(
  engine: &StorageEngine, tx_id: Option<&str>, user_id: &str,
) -> StorageResult<Vec<DocumentShareInvitationDto>> {
  engine.with_conn(tx_id, async |conn| {
    sqlx::query_as::<_, DocumentShareInvitationDto>(
      "SELECT id, documentId AS document_id, recipientUserId AS recipient_user_id, role,
              invitedByUserId AS invited_by_user_id, createdAt AS created_at,
              acceptedAt AS accepted_at, declinedAt AS declined_at, revokedAt AS revoked_at
       FROM document_share_invitations WHERE recipientUserId = ? ORDER BY createdAt DESC",
    ).bind(user_id).fetch_all(&mut *conn).await.map_err(Into::into)
  }).await
}

pub async fn find_invitation(
  engine: &StorageEngine, tx_id: Option<&str>, id: &str,
) -> StorageResult<Option<DocumentShareInvitationDto>> {
  engine.with_conn(tx_id, async |conn| {
    sqlx::query_as::<_, DocumentShareInvitationDto>(
      "SELECT id, documentId AS document_id, recipientUserId AS recipient_user_id, role,
              invitedByUserId AS invited_by_user_id, createdAt AS created_at,
              acceptedAt AS accepted_at, declinedAt AS declined_at, revokedAt AS revoked_at
       FROM document_share_invitations WHERE id = ?",
    ).bind(id).fetch_optional(&mut *conn).await.map_err(Into::into)
  }).await
}

pub async fn set_invitation_state(
  engine: &StorageEngine, tx_id: Option<&str>, id: &str, field: &str, at: i64,
) -> StorageResult<()> {
  let column = match field { "acceptedAt" | "declinedAt" | "revokedAt" => field, _ => return Ok(()) };
  engine.with_conn(tx_id, async |conn| {
    sqlx::query(&format!("UPDATE document_share_invitations SET {column} = ? WHERE id = ?"))
      .bind(at).bind(id).execute(&mut *conn).await?;
    Ok(())
  }).await
}
