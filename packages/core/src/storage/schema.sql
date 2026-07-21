-- Statement boundaries: delimiter constant in engine.rs (STATEMENT_DELIMITER).

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  ownerUserId TEXT NOT NULL,
  metadata TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
-- ;;

CREATE INDEX IF NOT EXISTS idx_projects_owner_user_id ON projects(ownerUserId);
-- ;;

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'manuscript',
  metadata TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
-- ;;

CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
-- ;;

CREATE TABLE IF NOT EXISTS project_documents (
  projectId TEXT NOT NULL,
  documentId TEXT NOT NULL,
  addedAt INTEGER NOT NULL,
  PRIMARY KEY (projectId, documentId),
  FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE
);
-- ;;

CREATE TABLE IF NOT EXISTS yjs_documents (
  name TEXT PRIMARY KEY,
  data BLOB NOT NULL
);
-- ;;

CREATE TABLE IF NOT EXISTS document_content (
  documentId TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE
);
-- ;;

CREATE TABLE IF NOT EXISTS document_notes (
  id TEXT PRIMARY KEY,
  documentId TEXT NOT NULL,
  anchorKind TEXT NOT NULL CHECK (anchorKind IN ('block', 'marker')),
  anchorId TEXT NOT NULL,
  content TEXT NOT NULL,
  authorUserId TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE
);
-- ;;

CREATE INDEX IF NOT EXISTS idx_document_notes_document ON document_notes(documentId);
-- ;;

CREATE TABLE IF NOT EXISTS version_snapshots (
  id TEXT PRIMARY KEY,
  documentId TEXT NOT NULL,
  content TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE
);
-- ;;

CREATE INDEX IF NOT EXISTS idx_version_snapshots_document ON version_snapshots(documentId);
-- ;;

-- Assistant storage is deliberately project-owned. This destructive alpha
-- cutover drops the document-owned v1 table; no conversation data is migrated.
DROP TABLE IF EXISTS chat_threads;
-- ;;

CREATE TABLE IF NOT EXISTS assistant_threads (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  createdByUserId TEXT NOT NULL,
  title TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('ask', 'agent')),
  selectedRootMessageId TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
);
-- ;;

CREATE INDEX IF NOT EXISTS idx_assistant_threads_project_updated
  ON assistant_threads(projectId, updatedAt DESC, createdAt DESC);
-- ;;

CREATE TABLE IF NOT EXISTS assistant_messages (
  id TEXT PRIMARY KEY,
  threadId TEXT NOT NULL,
  parentId TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  partsJson TEXT NOT NULL,
  branchOrdinal INTEGER NOT NULL DEFAULT 0,
  selectedChildId TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (threadId) REFERENCES assistant_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (parentId) REFERENCES assistant_messages(id) ON DELETE CASCADE
);
-- ;;

CREATE INDEX IF NOT EXISTS idx_assistant_messages_thread_parent
  ON assistant_messages(threadId, parentId, branchOrdinal ASC, createdAt ASC);
-- ;;

CREATE TABLE IF NOT EXISTS assistant_thread_documents (
  id TEXT PRIMARY KEY,
  threadId TEXT NOT NULL,
  documentId TEXT,
  titleSnapshot TEXT NOT NULL,
  addedByUserId TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  FOREIGN KEY (threadId) REFERENCES assistant_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE SET NULL
);
-- ;;

CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_thread_documents_unique
  ON assistant_thread_documents(threadId, documentId)
  WHERE documentId IS NOT NULL;
-- ;;

CREATE TABLE IF NOT EXISTS assistant_message_documents (
  id TEXT PRIMARY KEY,
  messageId TEXT NOT NULL,
  documentId TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('active', 'attachment')),
  titleSnapshot TEXT NOT NULL,
  selectionFrom INTEGER,
  selectionTo INTEGER,
  createdAt INTEGER NOT NULL,
  FOREIGN KEY (messageId) REFERENCES assistant_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE SET NULL
);
-- ;;

CREATE INDEX IF NOT EXISTS idx_assistant_message_documents_message
  ON assistant_message_documents(messageId, kind);
-- ;;

CREATE TABLE IF NOT EXISTS assistant_runs (
  id TEXT PRIMARY KEY,
  threadId TEXT NOT NULL,
  userMessageId TEXT,
  assistantMessageId TEXT,
  createdByUserId TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('ask', 'agent')),
  providerConfigId TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  error TEXT,
  startedAt INTEGER,
  finishedAt INTEGER,
  createdAt INTEGER NOT NULL,
  FOREIGN KEY (threadId) REFERENCES assistant_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (userMessageId) REFERENCES assistant_messages(id) ON DELETE SET NULL,
  FOREIGN KEY (assistantMessageId) REFERENCES assistant_messages(id) ON DELETE SET NULL
);
-- ;;

CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_runs_one_active_per_thread
  ON assistant_runs(threadId)
  WHERE status IN ('queued', 'running');
-- ;;

CREATE TABLE IF NOT EXISTS assistant_preference_settings (
  scopeType TEXT NOT NULL CHECK (scopeType IN ('global', 'user', 'project')),
  scopeId TEXT NOT NULL,
  overridesJson TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY (scopeType, scopeId)
);
-- ;;

CREATE TABLE IF NOT EXISTS ai_provider_configs (
  id TEXT PRIMARY KEY,
  usage TEXT NOT NULL CHECK (usage IN ('generation', 'embedding')),
  name TEXT,
  providerId TEXT NOT NULL,
  type TEXT NOT NULL,
  baseUrl TEXT NOT NULL,
  model TEXT NOT NULL,
  apiKeyId TEXT,
  customHeaders TEXT NOT NULL DEFAULT '{}',
  sortOrder INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (apiKeyId) REFERENCES ai_api_keys(id) ON DELETE SET NULL
);
-- ;;

CREATE INDEX IF NOT EXISTS idx_ai_provider_configs_order
  ON ai_provider_configs(usage ASC, sortOrder ASC, createdAt ASC);
-- ;;

CREATE TABLE IF NOT EXISTS ai_api_keys (
  id TEXT PRIMARY KEY,
  baseUrl TEXT NOT NULL,
  name TEXT NOT NULL,
  apiKey TEXT NOT NULL,
  isDefault INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
-- ;;

CREATE INDEX IF NOT EXISTS idx_ai_api_keys_base_url
  ON ai_api_keys(baseUrl ASC, isDefault DESC, updatedAt DESC);
-- ;;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_api_keys_single_default
  ON ai_api_keys(baseUrl)
  WHERE isDefault = 1;
-- ;;

CREATE TABLE IF NOT EXISTS ai_model_selection_settings (
  usage TEXT NOT NULL CHECK (usage IN ('generation', 'embedding')),
  scopeType TEXT NOT NULL CHECK (scopeType IN ('global', 'user', 'project', 'document')),
  scopeId TEXT NOT NULL,
  providerConfigId TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY (usage, scopeType, scopeId)
);
-- ;;

CREATE TABLE IF NOT EXISTS job_queue (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  dedupeKey TEXT,
  payloadJson TEXT NOT NULL,
  availableAt INTEGER NOT NULL,
  leaseOwner TEXT,
  leaseUntil INTEGER,
  attempt INTEGER NOT NULL CHECK (attempt >= 0),
  maxAttempts INTEGER NOT NULL CHECK (maxAttempts > 0),
  priority INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  lastError TEXT,
  UNIQUE (type, dedupeKey)
);
-- ;;

CREATE INDEX IF NOT EXISTS idx_job_queue_leaseable
  ON job_queue(availableAt ASC, leaseUntil ASC, priority DESC, createdAt ASC);
-- ;;

CREATE INDEX IF NOT EXISTS idx_job_queue_type_created
  ON job_queue(type ASC, createdAt ASC);
-- ;;

CREATE TABLE IF NOT EXISTS job_queue_dead_letters (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  dedupeKey TEXT,
  payloadJson TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  maxAttempts INTEGER NOT NULL,
  lastError TEXT NOT NULL,
  failedAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL
);
-- ;;

CREATE TABLE IF NOT EXISTS indexing_strategy_settings (
  scopeType TEXT NOT NULL CHECK (scopeType IN ('global', 'user', 'project', 'document')),
  scopeId TEXT NOT NULL,
  strategyType TEXT NOT NULL CHECK (strategyType IN ('whole_document', 'sliding_window')),
  strategyProperties TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY (scopeType, scopeId)
);
-- ;;

CREATE TABLE IF NOT EXISTS document_embeddings (
  vectorKey TEXT PRIMARY KEY,
  documentId TEXT NOT NULL,
  providerConfigId TEXT,
  providerId TEXT NOT NULL,
  type TEXT NOT NULL,
  baseUrl TEXT NOT NULL,
  model TEXT NOT NULL,
  strategyType TEXT NOT NULL CHECK (strategyType IN ('whole_document', 'sliding_window')),
  strategyProperties TEXT NOT NULL,
  chunkOrdinal INTEGER NOT NULL CHECK (chunkOrdinal >= 0),
  chunkStart INTEGER NOT NULL CHECK (chunkStart >= 0),
  chunkEnd INTEGER NOT NULL CHECK (chunkEnd >= chunkStart),
  selectionFrom INTEGER,
  selectionTo INTEGER,
  chunkText TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  documentTimestamp INTEGER NOT NULL,
  contentHash TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE,
  UNIQUE(documentId, baseUrl, model, chunkOrdinal)
);
-- ;;

CREATE INDEX IF NOT EXISTS idx_document_embeddings_search
  ON document_embeddings(baseUrl ASC, model ASC, dimensions ASC, documentId ASC, documentTimestamp ASC);
-- ;;

CREATE INDEX IF NOT EXISTS idx_document_embeddings_document
  ON document_embeddings(documentId ASC);
-- ;;

CREATE TABLE IF NOT EXISTS document_embedding_vector_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vectorKey TEXT NOT NULL UNIQUE,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  FOREIGN KEY (vectorKey) REFERENCES document_embeddings(vectorKey) ON DELETE CASCADE
);
-- ;;

CREATE INDEX IF NOT EXISTS idx_document_embedding_vector_rows_dimensions
  ON document_embedding_vector_rows(dimensions ASC);
-- ;;

CREATE TABLE IF NOT EXISTS app_config_values (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt INTEGER NOT NULL CHECK (updatedAt > 0)
);
-- ;;

CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  lastLoginAt INTEGER
);
-- ;;

CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email);
-- ;;

CREATE TABLE IF NOT EXISTS auth_invitations (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  email TEXT,
  role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
  createdByUserId TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL,
  revokedAt INTEGER,
  usedAt INTEGER,
  usedByUserId TEXT,
  FOREIGN KEY (createdByUserId) REFERENCES auth_users(id) ON DELETE RESTRICT,
  FOREIGN KEY (usedByUserId) REFERENCES auth_users(id) ON DELETE SET NULL
);
-- ;;

CREATE INDEX IF NOT EXISTS idx_auth_invitations_token ON auth_invitations(token);
-- ;;

CREATE INDEX IF NOT EXISTS idx_auth_invitations_created_at ON auth_invitations(createdAt DESC);
-- ;;

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL,
  FOREIGN KEY (userId) REFERENCES auth_users(id) ON DELETE CASCADE
);
-- ;;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(userId);
-- ;;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expiresAt);
-- ;;

UPDATE ai_api_keys SET isDefault = 0 WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY baseUrl ORDER BY updatedAt DESC, createdAt DESC, id DESC
    ) AS rowNum FROM ai_api_keys WHERE isDefault = 1
  ) WHERE rowNum > 1
);
-- ;;
