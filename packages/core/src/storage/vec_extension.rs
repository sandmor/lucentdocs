use std::sync::atomic::{AtomicBool, Ordering};

use libsqlite3_sys as ffi;
use sqlite_vec::sqlite3_vec_init;
use sqlx::SqlitePool;

use crate::storage::error::{StorageError, StorageResult};

static VECTORS_REGISTERED: AtomicBool = AtomicBool::new(false);
static VECTORS_AVAILABLE: AtomicBool = AtomicBool::new(false);

pub fn vectors_available() -> bool {
  VECTORS_AVAILABLE.load(Ordering::Relaxed)
}

pub fn disable_vectors() {
  VECTORS_AVAILABLE.store(false, Ordering::Relaxed);
}

pub fn register_extension() -> StorageResult<()> {
  if VECTORS_REGISTERED.swap(true, Ordering::AcqRel) {
    return Ok(());
  }

  unsafe {
    type SqliteAutoExtension = unsafe extern "C" fn(
      *mut ffi::sqlite3,
      *mut *mut i8,
      *const ffi::sqlite3_api_routines,
    ) -> i32;
    let init: SqliteAutoExtension = std::mem::transmute(sqlite3_vec_init as *const ());
    let status = ffi::sqlite3_auto_extension(Some(init));
    if status != ffi::SQLITE_OK {
      return Err(StorageError::new(format!(
        "Failed to register sqlite-vec via sqlite3_auto_extension (code: {status})"
      )));
    }
  }

  VECTORS_AVAILABLE.store(true, Ordering::Relaxed);
  Ok(())
}

pub async fn verify_on_pool(pool: &SqlitePool) -> StorageResult<()> {
  let mut conn = pool.acquire().await?;
  sqlx::query("SELECT vec_version()")
    .execute(&mut *conn)
    .await
    .map_err(|error| {
      StorageError::new(format!(
        "sqlite-vec registration did not activate vec0: {error}"
      ))
    })?;
  Ok(())
}

pub fn vector_table_name(dimensions: i32) -> StorageResult<String> {
  if !(1..=8192).contains(&dimensions) {
    return Err(StorageError::new(format!(
      "Invalid embedding dimensions: {dimensions}"
    )));
  }
  Ok(format!("document_embedding_vec_{dimensions}"))
}

pub async fn ensure_vector_table(
  conn: &mut sqlx::SqliteConnection,
  dimensions: i32,
) -> StorageResult<()> {
  if !vectors_available() {
    return Err(StorageError::new(
      "sqlite-vec is unavailable; vector search is disabled",
    ));
  }

  let table = vector_table_name(dimensions)?;
  let sql = format!(
    "CREATE VIRTUAL TABLE IF NOT EXISTS {table} USING vec0(embedding float[{dimensions}] distance_metric=cosine)"
  );
  sqlx::query(&sql).execute(conn).await?;
  Ok(())
}
