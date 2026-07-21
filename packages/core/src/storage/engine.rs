use std::collections::HashMap;
use std::path::Path;
use std::str::FromStr;
use std::sync::Arc;

use sqlx::sqlite::{
  SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions, SqliteSynchronous,
};
use sqlx::SqliteConnection;

use crate::storage::error::{StorageError, StorageResult};
use crate::storage::vec_extension;

const SCHEMA: &str = include_str!("schema.sql");
const STATEMENT_DELIMITER: &str = "-- ;;";

fn schema_statements() -> impl Iterator<Item = &'static str> {
  SCHEMA
    .split(STATEMENT_DELIMITER)
    .map(str::trim)
    .filter(|statement| !statement.is_empty())
}

async fn apply_schema_on_connection(conn: &mut SqliteConnection) -> StorageResult<()> {
  for statement in schema_statements() {
    sqlx::query(statement).execute(&mut *conn).await?;
  }

  Ok(())
}

#[derive(Clone)]
pub struct StorageEngine {
  inner: Arc<EngineInner>,
}

struct EngineInner {
  pool: SqlitePool,
  db_path: String,
  transactions: tokio::sync::Mutex<HashMap<String, SqliteConnection>>,
  tx_queue: tokio::sync::Mutex<()>,
  #[allow(dead_code)]
  temp_db: Option<tempfile::NamedTempFile>,
}

impl StorageEngine {
  pub async fn open(db_path: &str) -> StorageResult<Self> {
    if let Err(error) = vec_extension::register_extension() {
      eprintln!("warning: failed to register sqlite-vec extension: {error}; vector search disabled");
    }

    let (storage_path, temp_db) = if db_path == ":memory:" {
      let temp = create_memory_temp_db()?;
      let path = temp.path().to_string_lossy().into_owned();
      (path, Some(temp))
    } else {
      (db_path.to_string(), None)
    };

    if db_path != ":memory:" {
      if let Some(parent) = Path::new(&storage_path).parent() {
        if !parent.as_os_str().is_empty() {
          std::fs::create_dir_all(parent)?;
        }
      }
    }

    let sqlite_target = resolve_sqlite_url(&storage_path);
    let connect_options = SqliteConnectOptions::from_str(&sqlite_target)
      .map_err(|e| StorageError::new(format!("Invalid sqlite target: {e}")))?
      .create_if_missing(true)
      .foreign_keys(true)
      .journal_mode(SqliteJournalMode::Wal)
      .synchronous(SqliteSynchronous::Full)
      .busy_timeout(std::time::Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
      .max_connections(8)
      .connect_with(connect_options)
      .await?;

    if vec_extension::vectors_available() {
      if let Err(error) = vec_extension::verify_on_pool(&pool).await {
        eprintln!(
          "warning: sqlite-vec registered but vec0 is unavailable: {error}; vector search disabled"
        );
        vec_extension::disable_vectors();
      }
    }

    let engine = Self {
      inner: Arc::new(EngineInner {
        pool,
        db_path: db_path.to_string(),
        transactions: tokio::sync::Mutex::new(HashMap::new()),
        tx_queue: tokio::sync::Mutex::new(()),
        temp_db,
      }),
    };

    engine.apply_schema().await?;
    Ok(engine)
  }

  pub fn db_path(&self) -> &str {
    &self.inner.db_path
  }

  pub fn pool(&self) -> &SqlitePool {
    &self.inner.pool
  }

  pub async fn apply_schema(&self) -> StorageResult<()> {
    let mut conn = self.inner.pool.acquire().await?;
    apply_schema_on_connection(&mut conn).await
  }

  pub async fn begin_transaction(&self) -> StorageResult<String> {
    let _queue = self.inner.tx_queue.lock().await;
    let mut conn = self.inner.pool.acquire().await?.detach();
    sqlx::query("BEGIN IMMEDIATE")
      .execute(&mut conn)
      .await?;
    let tx_id = nanoid::nanoid!();
    self.inner.transactions.lock().await.insert(tx_id.clone(), conn);
    Ok(tx_id)
  }

  pub async fn commit_transaction(&self, tx_id: &str) -> StorageResult<()> {
    let mut txs = self.inner.transactions.lock().await;
    let mut conn = txs
      .remove(tx_id)
      .ok_or_else(|| StorageError::new(format!("Unknown transaction: {tx_id}")))?;
    sqlx::query("COMMIT").execute(&mut conn).await?;
    Ok(())
  }

  pub async fn rollback_transaction(&self, tx_id: &str) -> StorageResult<()> {
    let mut txs = self.inner.transactions.lock().await;
    if let Some(mut conn) = txs.remove(tx_id) {
      let _ = sqlx::query("ROLLBACK").execute(&mut conn).await;
    }
    Ok(())
  }

  pub async fn with_conn<T>(
    &self,
    tx_id: Option<&str>,
    f: impl AsyncFnOnce(&mut SqliteConnection) -> StorageResult<T>,
  ) -> StorageResult<T> {
    match tx_id {
      Some(id) => {
        let mut txs = self.inner.transactions.lock().await;
        let conn = txs
          .get_mut(id)
          .ok_or_else(|| StorageError::new(format!("Unknown transaction: {id}")))?;
        f(conn).await
      }
      None => {
        let mut conn = self.inner.pool.acquire().await?;
        f(&mut conn).await
      }
    }
  }

  pub async fn close(&self) {
    self.inner.pool.close().await;
  }
}

fn create_memory_temp_db() -> StorageResult<tempfile::NamedTempFile> {
  let mut candidates: Vec<std::path::PathBuf> = Vec::new();

  if let Ok(dir) = std::env::var("LUCENTDOCS_MEM_DB_DIR") {
    if !dir.trim().is_empty() {
      candidates.push(std::path::PathBuf::from(dir));
    }
  }

  if let Ok(dir) = std::env::var("TMPDIR") {
    if !dir.trim().is_empty() {
      candidates.push(std::path::PathBuf::from(dir));
    }
  }

  candidates.push(std::path::PathBuf::from("tmp"));

  for dir in candidates {
    if std::fs::create_dir_all(&dir).is_err() {
      continue;
    }

    if let Ok(temp) = tempfile::Builder::new()
      .prefix("lucentdocs-mem-")
      .suffix(".db")
      .tempfile_in(dir)
    {
      return Ok(temp);
    }
  }

  Ok(tempfile::NamedTempFile::new()?)
}

fn resolve_sqlite_url(db_path: &str) -> String {
  if db_path.starts_with("sqlite:") {
    db_path.to_string()
  } else {
    format!("sqlite://{}", db_path)
  }
}
