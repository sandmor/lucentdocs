use crate::storage::dto::{AuthInvitationDto, AuthSessionDto, AuthUserDto};
use crate::storage::engine::StorageEngine;
use crate::storage::error::StorageResult;

#[derive(sqlx::FromRow)]
struct AuthUserRow {
  id: String,
  name: String,
  email: String,
  #[sqlx(rename = "passwordHash")]
  password_hash: String,
  role: String,
  #[sqlx(rename = "createdAt")]
  created_at: i64,
  #[sqlx(rename = "updatedAt")]
  updated_at: i64,
  #[sqlx(rename = "lastLoginAt")]
  last_login_at: Option<i64>,
}

#[derive(sqlx::FromRow)]
struct AuthInvitationRow {
  id: String,
  token: String,
  email: Option<String>,
  role: String,
  #[sqlx(rename = "createdByUserId")]
  created_by_user_id: String,
  #[sqlx(rename = "createdAt")]
  created_at: i64,
  #[sqlx(rename = "expiresAt")]
  expires_at: i64,
  #[sqlx(rename = "revokedAt")]
  revoked_at: Option<i64>,
  #[sqlx(rename = "usedAt")]
  used_at: Option<i64>,
  #[sqlx(rename = "usedByUserId")]
  used_by_user_id: Option<String>,
}

#[derive(sqlx::FromRow)]
struct AuthSessionRow {
  token: String,
  #[sqlx(rename = "userId")]
  user_id: String,
  #[sqlx(rename = "createdAt")]
  created_at: i64,
  #[sqlx(rename = "expiresAt")]
  expires_at: i64,
}

fn user_row_to_dto(row: AuthUserRow) -> AuthUserDto {
  AuthUserDto {
    id: row.id,
    name: row.name,
    email: row.email,
    password_hash: row.password_hash,
    role: row.role,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at,
  }
}

fn invitation_row_to_dto(row: AuthInvitationRow) -> AuthInvitationDto {
  AuthInvitationDto {
    id: row.id,
    token: row.token,
    email: row.email,
    role: row.role,
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    used_at: row.used_at,
    used_by_user_id: row.used_by_user_id,
  }
}

fn session_row_to_dto(row: AuthSessionRow) -> AuthSessionDto {
  AuthSessionDto {
    token: row.token,
    user_id: row.user_id,
    created_at: row.created_at,
    expires_at: row.expires_at,
  }
}

pub async fn count_users(engine: &StorageEngine, tx_id: Option<&str>) -> StorageResult<i32> {
  engine
    .with_conn(tx_id, async |conn| {
      let row = sqlx::query_as::<_, (i64,)>("SELECT COUNT(1) as count FROM auth_users")
        .fetch_one(&mut *conn)
        .await?;
      Ok(row.0 as i32)
    })
    .await
}

pub async fn count_admin_users(engine: &StorageEngine, tx_id: Option<&str>) -> StorageResult<i32> {
  engine
    .with_conn(tx_id, async |conn| {
      let row = sqlx::query_as::<_, (i64,)>(
        "SELECT COUNT(1) as count FROM auth_users WHERE role = 'admin'",
      )
      .fetch_one(&mut *conn)
      .await?;
      Ok(row.0 as i32)
    })
    .await
}

pub async fn list_users(engine: &StorageEngine, tx_id: Option<&str>) -> StorageResult<Vec<AuthUserDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, AuthUserRow>(
        "SELECT * FROM auth_users ORDER BY createdAt DESC",
      )
      .fetch_all(&mut *conn)
      .await?;
      Ok(rows.into_iter().map(user_row_to_dto).collect())
    })
    .await
}

pub async fn find_user_by_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  id: &str,
) -> StorageResult<Option<AuthUserDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let row = sqlx::query_as::<_, AuthUserRow>("SELECT * FROM auth_users WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *conn)
        .await?;
      Ok(row.map(user_row_to_dto))
    })
    .await
}

pub async fn find_user_by_email(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  email: &str,
) -> StorageResult<Option<AuthUserDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let row = sqlx::query_as::<_, AuthUserRow>("SELECT * FROM auth_users WHERE email = ?")
        .bind(email)
        .fetch_optional(&mut *conn)
        .await?;
      Ok(row.map(user_row_to_dto))
    })
    .await
}

pub async fn insert_user(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  user: &AuthUserDto,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query(
        "INSERT INTO auth_users
           (id, name, email, passwordHash, role, createdAt, updatedAt, lastLoginAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(&user.id)
      .bind(&user.name)
      .bind(&user.email)
      .bind(&user.password_hash)
      .bind(&user.role)
      .bind(user.created_at)
      .bind(user.updated_at)
      .bind(user.last_login_at)
      .execute(&mut *conn)
      .await?;
      Ok(())
    })
    .await
}

pub async fn update_user_role(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  id: &str,
  role: &str,
  updated_at: i64,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query("UPDATE auth_users SET role = ?, updatedAt = ? WHERE id = ?")
        .bind(role)
        .bind(updated_at)
        .bind(id)
        .execute(&mut *conn)
        .await?;
      Ok(())
    })
    .await
}

pub async fn update_user_last_login(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  id: &str,
  last_login_at: i64,
  updated_at: i64,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query("UPDATE auth_users SET lastLoginAt = ?, updatedAt = ? WHERE id = ?")
        .bind(last_login_at)
        .bind(updated_at)
        .bind(id)
        .execute(&mut *conn)
        .await?;
      Ok(())
    })
    .await
}

pub async fn delete_user_by_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  id: &str,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query("DELETE FROM auth_users WHERE id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
      Ok(())
    })
    .await
}

pub async fn list_invitations(
  engine: &StorageEngine,
  tx_id: Option<&str>,
) -> StorageResult<Vec<AuthInvitationDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let rows = sqlx::query_as::<_, AuthInvitationRow>(
        "SELECT * FROM auth_invitations ORDER BY createdAt DESC",
      )
      .fetch_all(&mut *conn)
      .await?;
      Ok(rows.into_iter().map(invitation_row_to_dto).collect())
    })
    .await
}

pub async fn find_invitation_by_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  id: &str,
) -> StorageResult<Option<AuthInvitationDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let row = sqlx::query_as::<_, AuthInvitationRow>(
        "SELECT * FROM auth_invitations WHERE id = ?",
      )
      .bind(id)
      .fetch_optional(&mut *conn)
      .await?;
      Ok(row.map(invitation_row_to_dto))
    })
    .await
}

pub async fn find_invitation_by_token(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  token: &str,
) -> StorageResult<Option<AuthInvitationDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let row = sqlx::query_as::<_, AuthInvitationRow>(
        "SELECT * FROM auth_invitations WHERE token = ?",
      )
      .bind(token)
      .fetch_optional(&mut *conn)
      .await?;
      Ok(row.map(invitation_row_to_dto))
    })
    .await
}

pub async fn insert_invitation(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  invitation: &AuthInvitationDto,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query(
        "INSERT INTO auth_invitations
           (id, token, email, role, createdByUserId, createdAt, expiresAt, revokedAt, usedAt, usedByUserId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(&invitation.id)
      .bind(&invitation.token)
      .bind(&invitation.email)
      .bind(&invitation.role)
      .bind(&invitation.created_by_user_id)
      .bind(invitation.created_at)
      .bind(invitation.expires_at)
      .bind(invitation.revoked_at)
      .bind(invitation.used_at)
      .bind(&invitation.used_by_user_id)
      .execute(&mut *conn)
      .await?;
      Ok(())
    })
    .await
}

pub async fn mark_invitation_used(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  id: &str,
  used_by_user_id: &str,
  used_at: i64,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query("UPDATE auth_invitations SET usedAt = ?, usedByUserId = ? WHERE id = ?")
        .bind(used_at)
        .bind(used_by_user_id)
        .bind(id)
        .execute(&mut *conn)
        .await?;
      Ok(())
    })
    .await
}

pub async fn revoke_invitation(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  id: &str,
  revoked_at: i64,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query("UPDATE auth_invitations SET revokedAt = ? WHERE id = ?")
        .bind(revoked_at)
        .bind(id)
        .execute(&mut *conn)
        .await?;
      Ok(())
    })
    .await
}

pub async fn insert_session(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  session: &AuthSessionDto,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query(
        "INSERT INTO auth_sessions (token, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)",
      )
      .bind(&session.token)
      .bind(&session.user_id)
      .bind(session.created_at)
      .bind(session.expires_at)
      .execute(&mut *conn)
      .await?;
      Ok(())
    })
    .await
}

pub async fn find_session_by_token(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  token: &str,
) -> StorageResult<Option<AuthSessionDto>> {
  engine
    .with_conn(tx_id, async |conn| {
      let row = sqlx::query_as::<_, AuthSessionRow>("SELECT * FROM auth_sessions WHERE token = ?")
        .bind(token)
        .fetch_optional(&mut *conn)
        .await?;
      Ok(row.map(session_row_to_dto))
    })
    .await
}

pub async fn delete_session_by_token(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  token: &str,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query("DELETE FROM auth_sessions WHERE token = ?")
        .bind(token)
        .execute(&mut *conn)
        .await?;
      Ok(())
    })
    .await
}

pub async fn delete_sessions_by_user_id(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  user_id: &str,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query("DELETE FROM auth_sessions WHERE userId = ?")
        .bind(user_id)
        .execute(&mut *conn)
        .await?;
      Ok(())
    })
    .await
}

pub async fn delete_expired_sessions(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  now: i64,
) -> StorageResult<()> {
  engine
    .with_conn(tx_id, async |conn| {
      sqlx::query("DELETE FROM auth_sessions WHERE expiresAt <= ?")
        .bind(now)
        .execute(&mut *conn)
        .await?;
      Ok(())
    })
    .await
}
