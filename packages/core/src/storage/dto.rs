use napi_derive::napi;
use serde_json::Map;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct ProjectDto {
  pub id: String,
  pub title: String,
  pub owner_user_id: String,
  pub metadata_json: Option<String>,
  pub created_at: i64,
  pub updated_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct UpdateProjectDataDto {
  pub title: Option<String>,
  pub owner_user_id: Option<String>,
  pub metadata_json: Option<String>,
  pub clear_metadata: bool,
  pub updated_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct DocumentDto {
  pub id: String,
  pub title: String,
  pub r#type: String,
  pub metadata_json: Option<String>,
  pub created_at: i64,
  pub updated_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct UpdateDocumentDataDto {
  pub title: Option<String>,
  pub metadata_json: Option<String>,
  pub clear_metadata: bool,
  pub updated_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct ProjectDocumentDto {
  pub project_id: String,
  pub document_id: String,
  pub added_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct DocumentContentDto {
  pub document_id: String,
  pub content: String,
  pub updated_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct DocumentNoteDto {
  pub id: String,
  pub document_id: String,
  pub anchor_kind: String,
  pub anchor_id: String,
  pub content: String,
  pub author_user_id: String,
  pub created_at: i64,
  pub updated_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct VersionSnapshotDto {
  pub id: String,
  pub document_id: String,
  pub content: String,
  pub created_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct VersionSnapshotMetaDto {
  pub id: String,
  pub document_id: String,
  pub created_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct VersionSnapshotCursorDto {
  pub id: String,
  pub document_id: String,
  pub content: String,
  pub created_at: i64,
  pub row_id: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct ChatThreadDto {
  pub id: String,
  pub project_id: String,
  pub document_id: String,
  pub title: String,
  pub messages: String,
  pub created_at: i64,
  pub updated_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct UpdateChatThreadDataDto {
  pub title: Option<String>,
  pub messages: Option<String>,
  pub updated_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct AuthUserDto {
  pub id: String,
  pub name: String,
  pub email: String,
  pub password_hash: String,
  pub role: String,
  pub created_at: i64,
  pub updated_at: i64,
  pub last_login_at: Option<i64>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct AuthInvitationDto {
  pub id: String,
  pub token: String,
  pub email: Option<String>,
  pub role: String,
  pub created_by_user_id: String,
  pub created_at: i64,
  pub expires_at: i64,
  pub revoked_at: Option<i64>,
  pub used_at: Option<i64>,
  pub used_by_user_id: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct AuthSessionDto {
  pub token: String,
  pub user_id: String,
  pub created_at: i64,
  pub expires_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct AiProviderConfigDto {
  pub id: String,
  pub usage: String,
  pub name: Option<String>,
  pub provider_id: String,
  pub r#type: String,
  pub base_url: String,
  pub model: String,
  pub api_key_id: Option<String>,
  pub custom_headers_json: String,
  pub sort_order: i32,
  pub created_at: i64,
  pub updated_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct UpsertAiProviderConfigDto {
  pub id: String,
  pub usage: String,
  pub name: Option<String>,
  pub provider_id: String,
  pub r#type: String,
  pub base_url: String,
  pub model: String,
  pub api_key_id: Option<String>,
  pub custom_headers_json: String,
  pub sort_order: i32,
  pub created_at: i64,
  pub updated_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct AiApiKeyDto {
  pub id: String,
  pub base_url: String,
  pub name: String,
  pub api_key: String,
  pub is_default: bool,
  pub created_at: i64,
  pub updated_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct UpdateAiApiKeyDataDto {
  pub name: Option<String>,
  pub api_key: Option<String>,
  pub updated_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct AiModelSelectionDto {
  pub usage: String,
  pub scope_type: String,
  pub scope_id: String,
  pub provider_config_id: String,
  pub updated_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct UpsertAiModelSelectionDto {
  pub usage: String,
  pub scope_type: String,
  pub scope_id: String,
  pub provider_config_id: String,
  pub updated_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct IndexingSettingsDto {
  pub scope_type: String,
  pub scope_id: String,
  pub strategy_type: String,
  pub strategy_properties_json: String,
  pub updated_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct UpsertIndexingSettingsDto {
  pub scope_type: String,
  pub scope_id: String,
  pub strategy_type: String,
  pub strategy_properties_json: String,
  pub updated_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct AppConfigEntryDto {
  pub key: String,
  pub value: String,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct QueueJobDto {
  pub id: String,
  pub r#type: String,
  pub dedupe_key: Option<String>,
  pub payload_json: String,
  pub available_at: i64,
  pub lease_owner: Option<String>,
  pub lease_until: Option<i64>,
  pub attempt: i32,
  pub max_attempts: i32,
  pub priority: i32,
  pub created_at: i64,
  pub updated_at: i64,
  pub last_error: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct EnqueueJobInputDto {
  pub r#type: String,
  pub dedupe_key: Option<String>,
  pub payload_json: String,
  pub run_at: Option<i64>,
  pub max_attempts: Option<i32>,
  pub priority: Option<i32>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct UpsertUniqueJobInputDto {
  pub r#type: String,
  pub dedupe_key: String,
  pub payload_json: String,
  pub run_at: i64,
  pub max_attempts: Option<i32>,
  pub priority: Option<i32>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct LeaseJobsInputDto {
  pub worker_id: String,
  pub now: i64,
  pub lease_duration_ms: i64,
  pub limit: i32,
  pub types_json: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct CompleteLeasedJobInputDto {
  pub id: String,
  pub worker_id: String,
  pub expected_updated_at: Option<i64>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct FailLeasedJobInputDto {
  pub id: String,
  pub worker_id: String,
  pub now: i64,
  pub error: String,
  pub retry_delay_ms: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct JobQueueTypeStatsDto {
  pub total_queued: i32,
  pub next_available_at: Option<i64>,
  pub oldest_queued_at: Option<i64>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct DocumentEmbeddingDto {
  pub id: i64,
  pub vector_key: String,
  pub document_id: String,
  pub provider_config_id: Option<String>,
  pub provider_id: String,
  pub r#type: String,
  pub base_url: String,
  pub model: String,
  pub strategy_type: String,
  pub strategy_properties_json: String,
  pub chunk_ordinal: i32,
  pub chunk_start: i32,
  pub chunk_end: i32,
  pub selection_from: Option<i32>,
  pub selection_to: Option<i32>,
  pub chunk_text: String,
  pub dimensions: i32,
  pub document_timestamp: i64,
  pub content_hash: String,
  pub created_at: i64,
  pub updated_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct ReplaceEmbeddingChunkDto {
  pub ordinal: i32,
  pub start: i32,
  pub end: i32,
  pub selection_from: Option<i32>,
  pub selection_to: Option<i32>,
  pub text: String,
  pub vector_key: Option<String>,
  pub embedding_json: String,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct ReplaceDocumentEmbeddingsInputDto {
  pub document_id: String,
  pub provider_config_id: Option<String>,
  pub provider_id: String,
  pub r#type: String,
  pub base_url: String,
  pub model: String,
  pub strategy_type: String,
  pub strategy_properties_json: String,
  pub document_timestamp: i64,
  pub content_hash: String,
  pub chunks: Vec<ReplaceEmbeddingChunkDto>,
  pub created_at: i64,
  pub updated_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct ReplaceDocumentEmbeddingsResultDto {
  pub status: String,
  pub embeddings: Vec<DocumentEmbeddingDto>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct SearchDocumentEmbeddingsInputDto {
  pub project_id: Option<String>,
  pub document_id: Option<String>,
  pub base_url: String,
  pub model: String,
  pub query_embedding_json: String,
  pub limit: i32,
  pub scope_type: String,
  pub directory_path: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct EmbeddingSearchMatchDto {
  pub document_id: String,
  pub title: String,
  pub created_at: i64,
  pub updated_at: i64,
  pub strategy_type: String,
  pub chunk_ordinal: i32,
  pub chunk_start: i32,
  pub chunk_end: i32,
  pub selection_from: Option<i32>,
  pub selection_to: Option<i32>,
  pub chunk_text: String,
  pub distance: f64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct EmbeddingVectorReferenceDto {
  pub document_id: String,
  pub vector_key: String,
  pub base_url: String,
  pub model: String,
  pub dimensions: i32,
  pub vector_row_id: Option<i64>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct EmbeddingSearchMetadataDto {
  pub vector_key: String,
  pub document_id: String,
  pub title: String,
  pub created_at: i64,
  pub updated_at: i64,
  pub strategy_type: String,
  pub chunk_ordinal: i32,
  pub chunk_start: i32,
  pub chunk_end: i32,
  pub selection_from: Option<i32>,
  pub selection_to: Option<i32>,
  pub chunk_text: String,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct DocumentVectorPayloadContextDto {
  pub document_id: String,
  pub title: String,
  pub project_ids_json: String,
  pub parent_directory: String,
  pub directory_ancestors_json: String,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct ReplaceEmbeddingMetadataChunkDto {
  pub vector_key: String,
  pub ordinal: i32,
  pub start: i32,
  pub end: i32,
  pub selection_from: Option<i32>,
  pub selection_to: Option<i32>,
  pub text: String,
  pub dimensions: i32,
}

#[napi(object)]
pub struct PersistBundleInputDto {
  pub document_id: String,
  pub yjs_data: napi::bindgen_prelude::Buffer,
  pub content_json: String,
  pub content_updated_at: i64,
  pub notes_json: String,
  pub snapshot_id: Option<String>,
  pub snapshot_content_json: Option<String>,
  pub snapshot_created_at: Option<i64>,
}

pub type JsonMap = Map<String, serde_json::Value>;
