use std::fmt;

#[derive(Debug)]
pub struct StorageError {
  message: String,
}

impl StorageError {
  pub fn new(message: impl Into<String>) -> Self {
    Self {
      message: message.into(),
    }
  }
}

impl fmt::Display for StorageError {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "{}", self.message)
  }
}

impl std::error::Error for StorageError {}

impl From<sqlx::Error> for StorageError {
  fn from(value: sqlx::Error) -> Self {
    Self::new(value.to_string())
  }
}

impl From<std::io::Error> for StorageError {
  fn from(value: std::io::Error) -> Self {
    Self::new(value.to_string())
  }
}

impl From<serde_json::Error> for StorageError {
  fn from(value: serde_json::Error) -> Self {
    Self::new(value.to_string())
  }
}

pub type StorageResult<T> = Result<T, StorageError>;