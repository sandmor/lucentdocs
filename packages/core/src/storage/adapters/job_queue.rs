use std::sync::OnceLock;
use std::time::Duration;

use sqlx::SqliteConnection;
use tokio::sync::broadcast;

use crate::storage::adapters::{now_ms, with_transaction};
use crate::storage::dto::{
  CompleteLeasedJobInputDto, EnqueueJobInputDto, FailLeasedJobInputDto, JobQueueTypeStatsDto,
  LeaseJobsInputDto, QueueJobDto, UpsertUniqueJobInputDto,
};
use crate::storage::engine::StorageEngine;
use crate::storage::error::{StorageError, StorageResult};

const LOCK_RETRY_ATTEMPTS: u32 = 6;
const LOCK_RETRY_BASE_MS: u64 = 20;

#[derive(Clone, Debug)]
struct WaitSignal {
  job_type: String,
  available_at: i64,
}

struct JobQueueNotifier {
  sender: broadcast::Sender<WaitSignal>,
}

static NOTIFIER: OnceLock<JobQueueNotifier> = OnceLock::new();

fn notifier() -> &'static JobQueueNotifier {
  NOTIFIER.get_or_init(|| {
    let (sender, _) = broadcast::channel(256);
    JobQueueNotifier { sender }
  })
}

fn notify_waiters(job_type: &str, available_at: i64) {
  let _ = notifier().sender.send(WaitSignal {
    job_type: job_type.to_string(),
    available_at,
  });
}

fn is_sqlite_lock_error(err: &StorageError) -> bool {
  let msg = err.to_string();
  msg.contains("database is locked")
    || msg.contains("SQLITE_BUSY")
    || msg.contains("SQLITE_LOCKED")
}

async fn with_lock_retry<F, Fut, T>(operation: F) -> StorageResult<T>
where
  F: Fn() -> Fut,
  Fut: std::future::Future<Output = StorageResult<T>>,
{
  for attempt in 1..=LOCK_RETRY_ATTEMPTS {
    match operation().await {
      Ok(value) => return Ok(value),
      Err(err) if attempt < LOCK_RETRY_ATTEMPTS && is_sqlite_lock_error(&err) => {
        tokio::time::sleep(Duration::from_millis(
          LOCK_RETRY_BASE_MS * 2u64.pow(attempt - 1),
        ))
        .await;
      }
      Err(err) => return Err(err),
    }
  }
  unreachable!()
}

fn normalize_attempts(max_attempts: Option<i32>) -> StorageResult<i32> {
  match max_attempts {
    None => Ok(8),
    Some(value) if value > 0 => Ok(value),
    Some(_) => Err(StorageError::new("maxAttempts must be a positive integer.")),
  }
}

fn normalize_priority(priority: Option<i32>) -> StorageResult<i32> {
  match priority {
    None => Ok(0),
    Some(value) => Ok(value),
  }
}

fn next_updated_at(previous_updated_at: i64, now: i64) -> i64 {
  if now > previous_updated_at {
    now
  } else {
    previous_updated_at + 1
  }
}

#[derive(sqlx::FromRow)]
struct QueueRow {
  id: String,
  r#type: String,
  #[sqlx(rename = "dedupeKey")]
  dedupe_key: Option<String>,
  #[sqlx(rename = "payloadJson")]
  payload_json: String,
  #[sqlx(rename = "availableAt")]
  available_at: i64,
  #[sqlx(rename = "leaseOwner")]
  lease_owner: Option<String>,
  #[sqlx(rename = "leaseUntil")]
  lease_until: Option<i64>,
  attempt: i32,
  #[sqlx(rename = "maxAttempts")]
  max_attempts: i32,
  priority: i32,
  #[sqlx(rename = "createdAt")]
  created_at: i64,
  #[sqlx(rename = "updatedAt")]
  updated_at: i64,
  #[sqlx(rename = "lastError")]
  last_error: Option<String>,
}

fn row_to_dto(row: QueueRow) -> QueueJobDto {
  QueueJobDto {
    id: row.id,
    r#type: row.r#type,
    dedupe_key: row.dedupe_key,
    payload_json: row.payload_json,
    available_at: row.available_at,
    lease_owner: row.lease_owner,
    lease_until: row.lease_until,
    attempt: row.attempt,
    max_attempts: row.max_attempts,
    priority: row.priority,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_error: row.last_error,
  }
}

fn parse_types_json(types_json: Option<&str>) -> StorageResult<Option<Vec<String>>> {
  match types_json {
    None => Ok(None),
    Some(raw) if raw.trim().is_empty() => Ok(None),
    Some(raw) => {
      let parsed: Vec<String> = serde_json::from_str(raw)?;
      Ok(Some(parsed))
    }
  }
}

fn build_type_filter(types: Option<&[String]>) -> (String, Vec<String>) {
  match types {
    None | Some([]) => (String::new(), Vec::new()),
    Some(values) => {
      let placeholders = std::iter::repeat_n("?", values.len())
        .collect::<Vec<_>>()
        .join(", ");
      (format!(" AND type IN ({placeholders})"), values.to_vec())
    }
  }
}

async fn has_due_jobs_conn(
  conn: &mut SqliteConnection,
  now: i64,
  types: Option<&[String]>,
) -> StorageResult<bool> {
  let (type_filter_sql, type_params) = build_type_filter(types);
  let sql = format!(
    "SELECT 1 AS found
       FROM job_queue
      WHERE availableAt <= ?
        AND (leaseUntil IS NULL OR leaseUntil <= ?)
        {type_filter_sql}
      LIMIT 1"
  );

  let mut query = sqlx::query_as::<_, (i32,)>(&sql).bind(now).bind(now);
  for value in type_params {
    query = query.bind(value);
  }

  Ok(query.fetch_optional(&mut *conn).await?.is_some())
}

async fn get_next_available_at_conn(
  conn: &mut SqliteConnection,
  now: i64,
  types: Option<&[String]>,
) -> StorageResult<Option<i64>> {
  let (type_filter_sql, type_params) = build_type_filter(types);
  let sql = format!(
    "SELECT MIN(availableAt) AS nextAvailableAt
       FROM job_queue
      WHERE (leaseUntil IS NULL OR leaseUntil <= ?)
        {type_filter_sql}"
  );

  let mut query = sqlx::query_as::<_, (Option<i64>,)>(&sql).bind(now);
  for value in type_params {
    query = query.bind(value);
  }

  let row = query.fetch_one(&mut *conn).await?;
  Ok(row.0)
}

async fn fetch_queue_row(conn: &mut SqliteConnection, id: &str) -> StorageResult<QueueRow> {
  sqlx::query_as::<_, QueueRow>("SELECT * FROM job_queue WHERE id = ?")
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| StorageError::new(format!("Failed to load queued job {id}.")))
}

pub async fn enqueue(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  input: &EnqueueJobInputDto,
) -> StorageResult<QueueJobDto> {
  with_lock_retry(|| async {
    let now = now_ms();
    let id = nanoid::nanoid!();
    let available_at = input.run_at.unwrap_or(now);
    let max_attempts = normalize_attempts(input.max_attempts)?;
    let priority = normalize_priority(input.priority)?;

    let row = engine
      .with_conn(tx_id, async |conn| {
          sqlx::query(
            "INSERT INTO job_queue (
               id, type, dedupeKey, payloadJson, availableAt,
               leaseOwner, leaseUntil, attempt, maxAttempts, priority,
               createdAt, updatedAt, lastError
             ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, ?, ?, NULL)",
          )
          .bind(&id)
          .bind(&input.r#type)
          .bind(&input.dedupe_key)
          .bind(&input.payload_json)
          .bind(available_at)
          .bind(max_attempts)
          .bind(priority)
          .bind(now)
          .bind(now)
          .execute(&mut *conn)
          .await?;

          fetch_queue_row(&mut *conn, &id).await
      })
      .await?;

    notify_waiters(&input.r#type, available_at);
    Ok(row_to_dto(row))
  })
  .await
}

pub async fn upsert_unique(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  input: &UpsertUniqueJobInputDto,
) -> StorageResult<QueueJobDto> {
  with_lock_retry(|| async {
    let now = now_ms();
    let max_attempts = normalize_attempts(input.max_attempts)?;
    let priority = normalize_priority(input.priority)?;

    let row = with_transaction(engine, tx_id, async |engine, tx| {
      engine
        .with_conn(Some(tx), async |conn| {
            let existing = sqlx::query_as::<_, QueueRow>(
              "SELECT *
                 FROM job_queue
                WHERE type = ? AND dedupeKey = ?
                LIMIT 1",
            )
            .bind(&input.r#type)
            .bind(&input.dedupe_key)
            .fetch_optional(&mut *conn)
            .await?;

            if let Some(existing) = existing {
              let updated_at = next_updated_at(existing.updated_at, now);
              sqlx::query(
                "UPDATE job_queue
                    SET payloadJson = ?,
                        availableAt = ?,
                        leaseOwner = NULL,
                        leaseUntil = NULL,
                        attempt = 0,
                        maxAttempts = ?,
                        priority = ?,
                        updatedAt = ?,
                        lastError = NULL
                  WHERE id = ?",
              )
              .bind(&input.payload_json)
              .bind(input.run_at)
              .bind(max_attempts)
              .bind(priority)
              .bind(updated_at)
              .bind(&existing.id)
              .execute(&mut *conn)
              .await?;

              fetch_queue_row(&mut *conn, &existing.id).await
            } else {
              let id = nanoid::nanoid!();
              sqlx::query(
                "INSERT INTO job_queue (
                   id, type, dedupeKey, payloadJson, availableAt,
                   leaseOwner, leaseUntil, attempt, maxAttempts, priority,
                   createdAt, updatedAt, lastError
                 ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, ?, ?, NULL)",
              )
              .bind(&id)
              .bind(&input.r#type)
              .bind(&input.dedupe_key)
              .bind(&input.payload_json)
              .bind(input.run_at)
              .bind(max_attempts)
              .bind(priority)
              .bind(now)
              .bind(now)
              .execute(&mut *conn)
              .await?;

              fetch_queue_row(&mut *conn, &id).await
            }
        })
        .await
    })
    .await?;

    notify_waiters(&row.r#type, row.available_at);
    Ok(row_to_dto(row))
  })
  .await
}

pub async fn lease(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  input: &LeaseJobsInputDto,
) -> StorageResult<Vec<QueueJobDto>> {
  if input.limit <= 0 {
    return Ok(Vec::new());
  }

  with_lock_retry(|| async {
    with_transaction(engine, tx_id, async |engine, tx| {
      engine
        .with_conn(Some(tx), async |conn| {
            let types = parse_types_json(input.types_json.as_deref())?;
            let (type_filter_sql, type_params) = build_type_filter(types.as_deref());

            let candidate_sql = format!(
              "SELECT id
                 FROM job_queue
                WHERE availableAt <= ?
                  AND (leaseUntil IS NULL OR leaseUntil <= ?)
                  {type_filter_sql}
                ORDER BY priority DESC, availableAt ASC, createdAt ASC
                LIMIT ?"
            );

            let mut candidate_query = sqlx::query_as::<_, (String,)>(&candidate_sql)
              .bind(input.now)
              .bind(input.now);
            for value in &type_params {
              candidate_query = candidate_query.bind(value);
            }
            candidate_query = candidate_query.bind(input.limit);

            let candidates = candidate_query.fetch_all(&mut *conn).await?;
            let mut leased = Vec::new();

            for (candidate_id,) in candidates {
              let result = sqlx::query(
                "UPDATE job_queue
                    SET leaseOwner = ?,
                        leaseUntil = ?,
                        attempt = attempt + 1,
                        updatedAt = ?
                  WHERE id = ?
                    AND availableAt <= ?
                    AND (leaseUntil IS NULL OR leaseUntil <= ?)",
              )
              .bind(&input.worker_id)
              .bind(input.now + input.lease_duration_ms)
              .bind(input.now)
              .bind(&candidate_id)
              .bind(input.now)
              .bind(input.now)
              .execute(&mut *conn)
              .await?;

              if result.rows_affected() == 0 {
                continue;
              }

              if let Some(row) = sqlx::query_as::<_, QueueRow>(
                "SELECT * FROM job_queue WHERE id = ?",
              )
              .bind(&candidate_id)
              .fetch_optional(&mut *conn)
              .await?
              {
                leased.push(row_to_dto(row));
              }
            }

            Ok(leased)
        })
        .await
    })
    .await
  })
  .await
}

pub async fn complete(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  input: &CompleteLeasedJobInputDto,
) -> StorageResult<String> {
  with_lock_retry(|| async {
    with_transaction(engine, tx_id, async |engine, tx| {
      engine
        .with_conn(Some(tx), async |conn| {
            let row = sqlx::query_as::<_, QueueRow>("SELECT * FROM job_queue WHERE id = ?")
              .bind(&input.id)
              .fetch_optional(&mut *conn)
              .await?;

            let Some(row) = row else {
              return Ok("missing".to_string());
            };

            if row.lease_owner.as_deref() != Some(input.worker_id.as_str()) {
              if let Some(expected) = input.expected_updated_at {
                if row.updated_at != expected {
                  return Ok("released".to_string());
                }
              }
              return Ok("missing".to_string());
            }

            if let Some(expected) = input.expected_updated_at {
              if row.updated_at != expected {
                sqlx::query(
                  "UPDATE job_queue
                      SET leaseOwner = NULL,
                          leaseUntil = NULL
                    WHERE id = ? AND leaseOwner = ?",
                )
                .bind(&input.id)
                .bind(&input.worker_id)
                .execute(&mut *conn)
                .await?;
                notify_waiters(&row.r#type, row.available_at);
                return Ok("released".to_string());
              }
            }

            sqlx::query("DELETE FROM job_queue WHERE id = ? AND leaseOwner = ?")
              .bind(&input.id)
              .bind(&input.worker_id)
              .execute(&mut *conn)
              .await?;

            Ok("completed".to_string())
        })
        .await
    })
    .await
  })
  .await
}

pub async fn fail(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  input: &FailLeasedJobInputDto,
) -> StorageResult<String> {
  with_lock_retry(|| async {
    with_transaction(engine, tx_id, async |engine, tx| {
      engine
        .with_conn(Some(tx), async |conn| {
            let row = sqlx::query_as::<_, QueueRow>(
              "SELECT * FROM job_queue WHERE id = ? AND leaseOwner = ?",
            )
            .bind(&input.id)
            .bind(&input.worker_id)
            .fetch_optional(&mut *conn)
            .await?;

            let Some(row) = row else {
              return Ok("missing".to_string());
            };

            if row.attempt >= row.max_attempts {
              sqlx::query(
                "INSERT INTO job_queue_dead_letters (
                   id, type, dedupeKey, payloadJson, attempt, maxAttempts,
                   lastError, failedAt, createdAt
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
              )
              .bind(&row.id)
              .bind(&row.r#type)
              .bind(&row.dedupe_key)
              .bind(&row.payload_json)
              .bind(row.attempt)
              .bind(row.max_attempts)
              .bind(&input.error)
              .bind(input.now)
              .bind(row.created_at)
              .execute(&mut *conn)
              .await?;

              sqlx::query("DELETE FROM job_queue WHERE id = ?")
                .bind(&row.id)
                .execute(&mut *conn)
                .await?;

              return Ok("dead".to_string());
            }

            let available_at = input.now + input.retry_delay_ms;
            sqlx::query(
              "UPDATE job_queue
                  SET leaseOwner = NULL,
                      leaseUntil = NULL,
                      availableAt = ?,
                      updatedAt = ?,
                      lastError = ?
                WHERE id = ?",
            )
            .bind(available_at)
            .bind(input.now)
            .bind(&input.error)
            .bind(&row.id)
            .execute(&mut *conn)
            .await?;

            notify_waiters(&row.r#type, available_at);
            Ok("retrying".to_string())
        })
        .await
    })
    .await
  })
  .await
}

pub async fn get_by_type_and_dedupe_key(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  job_type: &str,
  dedupe_key: &str,
) -> StorageResult<Option<QueueJobDto>> {
  engine
    .with_conn(tx_id, async |conn| {
        let row = sqlx::query_as::<_, QueueRow>(
          "SELECT *
             FROM job_queue
            WHERE type = ? AND dedupeKey = ?
            LIMIT 1",
        )
        .bind(job_type)
        .bind(dedupe_key)
        .fetch_optional(&mut *conn)
        .await?;
        Ok(row.map(row_to_dto))
    })
    .await
}

pub async fn get_by_type_and_dedupe_keys(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  job_type: &str,
  dedupe_keys: &[String],
) -> StorageResult<Vec<QueueJobDto>> {
  if dedupe_keys.is_empty() {
    return Ok(Vec::new());
  }

  let placeholders = std::iter::repeat_n("?", dedupe_keys.len())
    .collect::<Vec<_>>()
    .join(", ");
  let sql = format!(
    "SELECT *
       FROM job_queue
      WHERE type = ?
        AND dedupeKey IN ({placeholders})"
  );

  engine
    .with_conn(tx_id, async |conn| {
        let mut query = sqlx::query_as::<_, QueueRow>(&sql).bind(job_type);
        for key in dedupe_keys {
          query = query.bind(key);
        }
        let rows = query.fetch_all(&mut *conn).await?;
        Ok(rows.into_iter().map(row_to_dto).collect())
    })
    .await
}

pub async fn list_queued_by_type(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  job_type: &str,
) -> StorageResult<Vec<QueueJobDto>> {
  engine
    .with_conn(tx_id, async |conn| {
        let rows = sqlx::query_as::<_, QueueRow>(
          "SELECT *
             FROM job_queue
            WHERE type = ?
            ORDER BY createdAt ASC",
        )
        .bind(job_type)
        .fetch_all(&mut *conn)
        .await?;
        Ok(rows.into_iter().map(row_to_dto).collect())
    })
    .await
}

pub async fn delete_queued_by_type_and_dedupe_keys(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  job_type: &str,
  dedupe_keys: &[String],
) -> StorageResult<()> {
  if dedupe_keys.is_empty() {
    return Ok(());
  }

  with_lock_retry(|| async {
    let placeholders = std::iter::repeat_n("?", dedupe_keys.len())
      .collect::<Vec<_>>()
      .join(", ");
    let sql = format!(
      "DELETE FROM job_queue
        WHERE type = ?
          AND dedupeKey IN ({placeholders})"
    );

    engine
      .with_conn(tx_id, async |conn| {
          let mut query = sqlx::query(&sql).bind(job_type);
          for key in dedupe_keys {
            query = query.bind(key);
          }
          query.execute(&mut *conn).await?;
          Ok(())
      })
      .await
  })
  .await
}

pub async fn get_type_stats(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  job_type: &str,
) -> StorageResult<JobQueueTypeStatsDto> {
  engine
    .with_conn(tx_id, async |conn| {
        let row = sqlx::query_as::<_, (i64, Option<i64>, Option<i64>)>(
          "SELECT
             COUNT(*) AS totalQueued,
             MIN(availableAt) AS nextAvailableAt,
             MIN(createdAt) AS oldestQueuedAt
           FROM job_queue
           WHERE type = ?",
        )
        .bind(job_type)
        .fetch_one(&mut *conn)
        .await?;

        Ok(JobQueueTypeStatsDto {
          total_queued: row.0 as i32,
          next_available_at: row.1,
          oldest_queued_at: row.2,
        })
    })
    .await
}

pub async fn wait_for_available(
  engine: &StorageEngine,
  tx_id: Option<&str>,
  now: i64,
  timeout_ms: i64,
  types_json: Option<&str>,
) -> StorageResult<String> {
  if timeout_ms <= 0 {
    return Ok("timeout".to_string());
  }

  let types = parse_types_json(types_json)?;

  if engine
    .with_conn(tx_id, async |conn| { has_due_jobs_conn(&mut *conn, now, types.as_deref()).await })
    .await?
  {
    return Ok("due".to_string());
  }

  let max_wake_at = now + timeout_ms;
  let next_available_at = engine
    .with_conn(tx_id, async |conn| { get_next_available_at_conn(&mut *conn, now, types.as_deref()).await })
    .await?;

  let wake_at = match next_available_at {
    Some(next) => max_wake_at.min(next.max(now)),
    None => max_wake_at,
  };
  let wake_delay_ms = (wake_at - now).max(1);

  let mut receiver = notifier().sender.subscribe();

  if engine
    .with_conn(tx_id, async |conn| { has_due_jobs_conn(&mut *conn, now_ms(), types.as_deref()).await })
    .await?
  {
    return Ok("due".to_string());
  }

  tokio::select! {
    _ = tokio::time::sleep(Duration::from_millis(wake_delay_ms as u64)) => {
      Ok(if wake_at < max_wake_at { "scheduled".to_string() } else { "timeout".to_string() })
    }
    signal = receiver.recv() => {
      match signal {
        Ok(signal) => {
          if let Some(ref filter) = types {
            if !filter.is_empty() && !filter.contains(&signal.job_type) {
              return Ok("timeout".to_string());
            }
          }
          Ok(if signal.available_at <= now_ms() {
            "notified".to_string()
          } else {
            "scheduled".to_string()
          })
        }
        Err(_) => Ok("timeout".to_string()),
      }
    }
  }
}
