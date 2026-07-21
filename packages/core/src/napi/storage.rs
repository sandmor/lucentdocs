use std::collections::HashMap;
use std::sync::OnceLock;

use ::napi::bindgen_prelude::*;
use napi_derive::napi;
use tokio::runtime::Runtime;

use crate::import::MassImportRequest;
use crate::storage::adapters::{
  ai_model_selection, ai_settings, app_config, auth_data, chats, document_content,
  document_embedding_metadata, document_embeddings, document_notes, documents,
  indexing_settings, job_queue, persist_bundle, project_documents, projects,
  version_snapshots, yjs_documents,
};
use crate::storage::dto::{
  AiApiKeyDto, AiModelSelectionDto, AiProviderConfigDto, AppConfigEntryDto, AuthInvitationDto,
  AuthSessionDto, AuthUserDto, ChatThreadDto, CompleteLeasedJobInputDto, DocumentContentDto,
  DocumentDto, DocumentEmbeddingDto, DocumentNoteDto, DocumentVectorPayloadContextDto,
  EmbeddingSearchMatchDto, EmbeddingSearchMetadataDto, EmbeddingVectorReferenceDto,
  EnqueueJobInputDto, FailLeasedJobInputDto, IndexingSettingsDto, JobQueueTypeStatsDto,
  LeaseJobsInputDto, PersistBundleInputDto, ProjectDocumentDto, ProjectDto, QueueJobDto,
  ReplaceDocumentEmbeddingsInputDto, ReplaceDocumentEmbeddingsResultDto,
  ReplaceEmbeddingMetadataChunkDto, SearchDocumentEmbeddingsInputDto, UpdateAiApiKeyDataDto,
  UpdateChatThreadDataDto, UpdateDocumentDataDto, UpdateProjectDataDto,
  UpsertAiModelSelectionDto, UpsertAiProviderConfigDto, UpsertIndexingSettingsDto,
  UpsertUniqueJobInputDto, VersionSnapshotCursorDto, VersionSnapshotDto, VersionSnapshotMetaDto,
};
use crate::storage::engine::StorageEngine;
use crate::storage::error::StorageError;

fn to_napi_err(err: StorageError) -> Error {
  Error::new(Status::GenericFailure, err.to_string())
}

fn blocking_runtime() -> &'static Runtime {
  static RUNTIME: OnceLock<Runtime> = OnceLock::new();
  RUNTIME.get_or_init(|| {
    Runtime::new().expect("failed to create tokio runtime for sync storage open")
  })
}

#[napi(object)]
pub struct WaitForAvailableResult {
  pub reason: String,
}

#[napi]
pub struct NativeStorageEngine {
  engine: StorageEngine,
}

#[napi]
pub struct NativeTransactionHandle {
  engine: StorageEngine,
  tx_id: String,
}

#[napi]
impl NativeTransactionHandle {
  #[napi]
  pub fn id(&self) -> String {
    self.tx_id.clone()
  }

  #[napi]
  pub async fn commit(&self) -> Result<()> {
    self
      .engine
      .commit_transaction(&self.tx_id)
      .await
      .map_err(to_napi_err)
  }

  #[napi]
  pub async fn rollback(&self) -> Result<()> {
    self
      .engine
      .rollback_transaction(&self.tx_id)
      .await
      .map_err(to_napi_err)
  }
}

#[napi]
impl NativeStorageEngine {
  #[napi(factory)]
  pub async fn open(db_path: String) -> Result<Self> {
    let engine = StorageEngine::open(&db_path)
      .await
      .map_err(to_napi_err)?;
    Ok(Self { engine })
  }

  #[napi(factory)]
  pub fn open_sync(db_path: String) -> Result<Self> {
    let engine = blocking_runtime()
      .block_on(StorageEngine::open(&db_path))
      .map_err(to_napi_err)?;
    Ok(Self { engine })
  }

  #[napi]
  pub async fn close(&self) -> Result<()> {
    self.engine.close().await;
    Ok(())
  }

  #[napi]
  pub async fn begin_transaction(&self) -> Result<NativeTransactionHandle> {
    let tx_id = self.engine.begin_transaction().await.map_err(to_napi_err)?;
    Ok(NativeTransactionHandle {
      engine: self.engine.clone(),
      tx_id,
    })
  }
  #[napi]
  pub async fn ai_model_selection_get(
    &self,
    tx_id: Option<String>,
    usage: String,
    scope_type: String,
    scope_id: String,
  ) -> Result<Option<AiModelSelectionDto>> {
    ai_model_selection::get(&self.engine, tx_id.as_deref(), &usage, &scope_type, &scope_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn ai_model_selection_get_many(
    &self,
    tx_id: Option<String>,
    usage: String,
    scope_type: String,
    scope_ids: Vec<String>,
  ) -> Result<Vec<AiModelSelectionDto>> {
    ai_model_selection::get_many(&self.engine, tx_id.as_deref(), &usage, &scope_type, &scope_ids)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn ai_model_selection_upsert(
    &self,
    tx_id: Option<String>,
    input: UpsertAiModelSelectionDto,
  ) -> Result<AiModelSelectionDto> {
    ai_model_selection::upsert(&self.engine, tx_id.as_deref(), &input)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn ai_model_selection_delete(
    &self,
    tx_id: Option<String>,
    usage: String,
    scope_type: String,
    scope_id: String,
  ) -> Result<()> {
    ai_model_selection::delete(&self.engine, tx_id.as_deref(), &usage, &scope_type, &scope_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn ai_settings_list_provider_configs(
    &self,
    tx_id: Option<String>,
    usage: String,
  ) -> Result<Vec<AiProviderConfigDto>> {
    ai_settings::list_provider_configs(&self.engine, tx_id.as_deref(), &usage)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn ai_settings_upsert_provider_config(
    &self,
    tx_id: Option<String>,
    input: UpsertAiProviderConfigDto,
  ) -> Result<()> {
    ai_settings::upsert_provider_config(&self.engine, tx_id.as_deref(), &input)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn ai_settings_delete_provider_configs_not_in(
    &self,
    tx_id: Option<String>,
    usage: String,
    ids: Vec<String>,
  ) -> Result<()> {
    ai_settings::delete_provider_configs_not_in(&self.engine, tx_id.as_deref(), &usage, &ids)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn ai_settings_list_api_keys(
    &self,
    tx_id: Option<String>,
  ) -> Result<Vec<AiApiKeyDto>> {
    ai_settings::list_api_keys(&self.engine, tx_id.as_deref())
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn ai_settings_find_api_key_by_id(
    &self,
    tx_id: Option<String>,
    id: String,
  ) -> Result<Option<AiApiKeyDto>> {
    ai_settings::find_api_key_by_id(&self.engine, tx_id.as_deref(), &id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn ai_settings_clear_default_api_keys(
    &self,
    tx_id: Option<String>,
    base_url: String,
    updated_at: i64,
  ) -> Result<()> {
    ai_settings::clear_default_api_keys(&self.engine, tx_id.as_deref(), &base_url, updated_at)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn ai_settings_insert_api_key(
    &self,
    tx_id: Option<String>,
    api_key: AiApiKeyDto,
  ) -> Result<()> {
    ai_settings::insert_api_key(&self.engine, tx_id.as_deref(), &api_key)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn ai_settings_update_api_key(
    &self,
    tx_id: Option<String>,
    id: String,
    data: UpdateAiApiKeyDataDto,
  ) -> Result<()> {
    ai_settings::update_api_key(&self.engine, tx_id.as_deref(), &id, &data)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn ai_settings_set_api_key_default(
    &self,
    tx_id: Option<String>,
    id: String,
    is_default: bool,
    updated_at: i64,
  ) -> Result<()> {
    ai_settings::set_api_key_default(&self.engine, tx_id.as_deref(), &id, is_default, updated_at)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn ai_settings_delete_api_key(
    &self,
    tx_id: Option<String>,
    id: String,
  ) -> Result<()> {
    ai_settings::delete_api_key(&self.engine, tx_id.as_deref(), &id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn ai_settings_clear_provider_api_key_references(
    &self,
    tx_id: Option<String>,
    api_key_id: String,
    updated_at: i64,
  ) -> Result<()> {
    ai_settings::clear_provider_api_key_references(&self.engine, tx_id.as_deref(), &api_key_id, updated_at)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn app_config_is_empty(
    &self,
    tx_id: Option<String>,
  ) -> Result<bool> {
    app_config::is_empty(&self.engine, tx_id.as_deref())
      .await
      .map_err(to_napi_err)
  }

  #[napi]
  pub fn app_config_is_empty_sync(&self, tx_id: Option<String>) -> Result<bool> {
    blocking_runtime()
      .block_on(app_config::is_empty(&self.engine, tx_id.as_deref()))
      .map_err(to_napi_err)
  }

  #[napi]
  pub async fn app_config_read_all(
    &self,
    tx_id: Option<String>,
  ) -> Result<Vec<AppConfigEntryDto>> {
    app_config::read_all(&self.engine, tx_id.as_deref())
      .await
      .map_err(to_napi_err)
  }

  #[napi]
  pub fn app_config_read_all_sync(
    &self,
    tx_id: Option<String>,
  ) -> Result<Vec<AppConfigEntryDto>> {
    blocking_runtime()
      .block_on(app_config::read_all(&self.engine, tx_id.as_deref()))
      .map_err(to_napi_err)
  }

  #[napi]
  pub async fn app_config_upsert_many(
    &self,
    tx_id: Option<String>,
    entries: Vec<AppConfigEntryDto>,
    updated_at: i64,
  ) -> Result<()> {
    app_config::upsert_many(&self.engine, tx_id.as_deref(), &entries, updated_at)
      .await
      .map_err(to_napi_err)
  }

  #[napi]
  pub fn app_config_upsert_many_sync(
    &self,
    tx_id: Option<String>,
    entries: Vec<AppConfigEntryDto>,
    updated_at: i64,
  ) -> Result<()> {
    blocking_runtime()
      .block_on(app_config::upsert_many(
        &self.engine,
        tx_id.as_deref(),
        &entries,
        updated_at,
      ))
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_count_users(
    &self,
    tx_id: Option<String>,
  ) -> Result<i32> {
    auth_data::count_users(&self.engine, tx_id.as_deref())
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_count_admin_users(
    &self,
    tx_id: Option<String>,
  ) -> Result<i32> {
    auth_data::count_admin_users(&self.engine, tx_id.as_deref())
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_list_users(
    &self,
    tx_id: Option<String>,
  ) -> Result<Vec<AuthUserDto>> {
    auth_data::list_users(&self.engine, tx_id.as_deref())
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_find_user_by_id(
    &self,
    tx_id: Option<String>,
    id: String,
  ) -> Result<Option<AuthUserDto>> {
    auth_data::find_user_by_id(&self.engine, tx_id.as_deref(), &id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_find_user_by_email(
    &self,
    tx_id: Option<String>,
    email: String,
  ) -> Result<Option<AuthUserDto>> {
    auth_data::find_user_by_email(&self.engine, tx_id.as_deref(), &email)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_insert_user(
    &self,
    tx_id: Option<String>,
    user: AuthUserDto,
  ) -> Result<()> {
    auth_data::insert_user(&self.engine, tx_id.as_deref(), &user)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_update_user_role(
    &self,
    tx_id: Option<String>,
    id: String,
    role: String,
    updated_at: i64,
  ) -> Result<()> {
    auth_data::update_user_role(&self.engine, tx_id.as_deref(), &id, &role, updated_at)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_update_user_last_login(
    &self,
    tx_id: Option<String>,
    id: String,
    last_login_at: i64,
    updated_at: i64,
  ) -> Result<()> {
    auth_data::update_user_last_login(&self.engine, tx_id.as_deref(), &id, last_login_at, updated_at)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_delete_user_by_id(
    &self,
    tx_id: Option<String>,
    id: String,
  ) -> Result<()> {
    auth_data::delete_user_by_id(&self.engine, tx_id.as_deref(), &id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_list_invitations(
    &self,
    tx_id: Option<String>,
  ) -> Result<Vec<AuthInvitationDto>> {
    auth_data::list_invitations(&self.engine, tx_id.as_deref())
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_find_invitation_by_id(
    &self,
    tx_id: Option<String>,
    id: String,
  ) -> Result<Option<AuthInvitationDto>> {
    auth_data::find_invitation_by_id(&self.engine, tx_id.as_deref(), &id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_find_invitation_by_token(
    &self,
    tx_id: Option<String>,
    token: String,
  ) -> Result<Option<AuthInvitationDto>> {
    auth_data::find_invitation_by_token(&self.engine, tx_id.as_deref(), &token)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_insert_invitation(
    &self,
    tx_id: Option<String>,
    invitation: AuthInvitationDto,
  ) -> Result<()> {
    auth_data::insert_invitation(&self.engine, tx_id.as_deref(), &invitation)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_mark_invitation_used(
    &self,
    tx_id: Option<String>,
    id: String,
    used_by_user_id: String,
    used_at: i64,
  ) -> Result<()> {
    auth_data::mark_invitation_used(&self.engine, tx_id.as_deref(), &id, &used_by_user_id, used_at)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_revoke_invitation(
    &self,
    tx_id: Option<String>,
    id: String,
    revoked_at: i64,
  ) -> Result<()> {
    auth_data::revoke_invitation(&self.engine, tx_id.as_deref(), &id, revoked_at)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_insert_session(
    &self,
    tx_id: Option<String>,
    session: AuthSessionDto,
  ) -> Result<()> {
    auth_data::insert_session(&self.engine, tx_id.as_deref(), &session)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_find_session_by_token(
    &self,
    tx_id: Option<String>,
    token: String,
  ) -> Result<Option<AuthSessionDto>> {
    auth_data::find_session_by_token(&self.engine, tx_id.as_deref(), &token)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_delete_session_by_token(
    &self,
    tx_id: Option<String>,
    token: String,
  ) -> Result<()> {
    auth_data::delete_session_by_token(&self.engine, tx_id.as_deref(), &token)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_delete_sessions_by_user_id(
    &self,
    tx_id: Option<String>,
    user_id: String,
  ) -> Result<()> {
    auth_data::delete_sessions_by_user_id(&self.engine, tx_id.as_deref(), &user_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn auth_data_delete_expired_sessions(
    &self,
    tx_id: Option<String>,
    now: i64,
  ) -> Result<()> {
    auth_data::delete_expired_sessions(&self.engine, tx_id.as_deref(), now)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn chats_find_by_id(
    &self,
    tx_id: Option<String>,
    project_id: String,
    document_id: String,
    id: String,
  ) -> Result<Option<ChatThreadDto>> {
    chats::find_by_id(&self.engine, tx_id.as_deref(), &project_id, &document_id, &id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn chats_list_by_document(
    &self,
    tx_id: Option<String>,
    project_id: String,
    document_id: String,
  ) -> Result<Vec<ChatThreadDto>> {
    chats::list_by_document(&self.engine, tx_id.as_deref(), &project_id, &document_id)
      .await
      .map_err(to_napi_err)
  }

  #[napi]
  pub async fn chats_list_by_project(
    &self,
    tx_id: Option<String>,
    project_id: String,
  ) -> Result<Vec<ChatThreadDto>> {
    chats::list_by_project(&self.engine, tx_id.as_deref(), &project_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn chats_insert(
    &self,
    tx_id: Option<String>,
    row: ChatThreadDto,
  ) -> Result<()> {
    chats::insert(&self.engine, tx_id.as_deref(), &row)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn chats_update(
    &self,
    tx_id: Option<String>,
    project_id: String,
    document_id: String,
    id: String,
    data: UpdateChatThreadDataDto,
  ) -> Result<bool> {
    chats::update(&self.engine, tx_id.as_deref(), &project_id, &document_id, &id, &data)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn chats_delete_by_id(
    &self,
    tx_id: Option<String>,
    project_id: String,
    document_id: String,
    id: String,
  ) -> Result<bool> {
    chats::delete_by_id(&self.engine, tx_id.as_deref(), &project_id, &document_id, &id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_content_find_by_document_id(
    &self,
    tx_id: Option<String>,
    document_id: String,
  ) -> Result<Option<DocumentContentDto>> {
    document_content::find_by_document_id(&self.engine, tx_id.as_deref(), &document_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_content_upsert(
    &self,
    tx_id: Option<String>,
    document_id: String,
    content_json: String,
    updated_at: i64,
  ) -> Result<()> {
    document_content::upsert(&self.engine, tx_id.as_deref(), &document_id, &content_json, updated_at)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_content_delete(
    &self,
    tx_id: Option<String>,
    document_id: String,
  ) -> Result<()> {
    document_content::delete(&self.engine, tx_id.as_deref(), &document_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_embedding_metadata_find_embeddings(
    &self,
    tx_id: Option<String>,
    document_id: String,
    base_url: String,
    model: String,
  ) -> Result<Vec<DocumentEmbeddingDto>> {
    document_embedding_metadata::find_embeddings(&self.engine, tx_id.as_deref(), &document_id, &base_url, &model)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_embedding_metadata_get_latest_timestamp(
    &self,
    tx_id: Option<String>,
    document_id: String,
    base_url: String,
    model: String,
  ) -> Result<Option<i64>> {
    document_embedding_metadata::get_latest_timestamp(&self.engine, tx_id.as_deref(), &document_id, &base_url, &model)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_embedding_metadata_list_vector_references(
    &self,
    tx_id: Option<String>,
    document_id: String,
    base_url: String,
    model: String,
  ) -> Result<Vec<EmbeddingVectorReferenceDto>> {
    document_embedding_metadata::list_vector_references(&self.engine, tx_id.as_deref(), &document_id, &base_url, &model)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_embedding_metadata_replace_embeddings(
    &self,
    tx_id: Option<String>,
    input: ReplaceDocumentEmbeddingsInputDto,
    chunks: Vec<ReplaceEmbeddingMetadataChunkDto>,
  ) -> Result<Vec<DocumentEmbeddingDto>> {
    document_embedding_metadata::replace_embeddings(&self.engine, tx_id.as_deref(), &input, &chunks)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_embedding_metadata_delete_embeddings_by_document_id(
    &self,
    tx_id: Option<String>,
    document_id: String,
  ) -> Result<()> {
    document_embedding_metadata::delete_embeddings_by_document_id(&self.engine, tx_id.as_deref(), &document_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_embedding_metadata_list_vector_references_by_document_id(
    &self,
    tx_id: Option<String>,
    document_id: String,
  ) -> Result<Vec<EmbeddingVectorReferenceDto>> {
    document_embedding_metadata::list_vector_references_by_document_id(&self.engine, tx_id.as_deref(), &document_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_embedding_metadata_list_vector_references_by_document_ids(
    &self,
    tx_id: Option<String>,
    document_ids: Vec<String>,
  ) -> Result<Vec<EmbeddingVectorReferenceDto>> {
    document_embedding_metadata::list_vector_references_by_document_ids(&self.engine, tx_id.as_deref(), &document_ids)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_embedding_metadata_delete_embeddings_by_vector_keys(
    &self,
    tx_id: Option<String>,
    vector_keys: Vec<String>,
  ) -> Result<i32> {
    document_embedding_metadata::delete_embeddings_by_vector_keys(&self.engine, tx_id.as_deref(), &vector_keys)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_embedding_metadata_get_vector_payload_context(
    &self,
    tx_id: Option<String>,
    document_id: String,
  ) -> Result<DocumentVectorPayloadContextDto> {
    document_embedding_metadata::get_vector_payload_context(&self.engine, tx_id.as_deref(), &document_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_embedding_metadata_list_search_metadata_by_vector_keys(
    &self,
    tx_id: Option<String>,
    vector_keys: Vec<String>,
  ) -> Result<HashMap<String, EmbeddingSearchMetadataDto>> {
    document_embedding_metadata::list_search_metadata_by_vector_keys(&self.engine, tx_id.as_deref(), &vector_keys)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_embeddings_find_embeddings(
    &self,
    tx_id: Option<String>,
    document_id: String,
    base_url: String,
    model: String,
  ) -> Result<Vec<DocumentEmbeddingDto>> {
    document_embeddings::find_embeddings(&self.engine, tx_id.as_deref(), &document_id, &base_url, &model)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_embeddings_search(
    &self,
    tx_id: Option<String>,
    input: SearchDocumentEmbeddingsInputDto,
  ) -> Result<Vec<EmbeddingSearchMatchDto>> {
    document_embeddings::search(&self.engine, tx_id.as_deref(), &input)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_embeddings_replace_embeddings(
    &self,
    tx_id: Option<String>,
    input: ReplaceDocumentEmbeddingsInputDto,
  ) -> Result<ReplaceDocumentEmbeddingsResultDto> {
    document_embeddings::replace_embeddings(&self.engine, tx_id.as_deref(), &input)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_embeddings_list_vector_references_by_document_ids(
    &self,
    tx_id: Option<String>,
    document_ids: Vec<String>,
  ) -> Result<Vec<EmbeddingVectorReferenceDto>> {
    document_embeddings::list_vector_references_by_document_ids(&self.engine, tx_id.as_deref(), &document_ids)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_embeddings_delete_vectors_by_references(
    &self,
    tx_id: Option<String>,
    references: Vec<EmbeddingVectorReferenceDto>,
  ) -> Result<()> {
    document_embeddings::delete_vectors_by_references(&self.engine, tx_id.as_deref(), &references)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_embeddings_delete_embeddings_by_document_id(
    &self,
    tx_id: Option<String>,
    document_id: String,
  ) -> Result<()> {
    document_embeddings::delete_embeddings_by_document_id(&self.engine, tx_id.as_deref(), &document_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_notes_list_by_document_id(
    &self,
    tx_id: Option<String>,
    document_id: String,
  ) -> Result<Vec<DocumentNoteDto>> {
    document_notes::list_by_document_id(&self.engine, tx_id.as_deref(), &document_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_notes_replace_all_for_document(
    &self,
    tx_id: Option<String>,
    document_id: String,
    notes: Vec<DocumentNoteDto>,
  ) -> Result<()> {
    document_notes::replace_all_for_document(&self.engine, tx_id.as_deref(), &document_id, &notes)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn document_notes_delete_by_document_id(
    &self,
    tx_id: Option<String>,
    document_id: String,
  ) -> Result<()> {
    document_notes::delete_by_document_id(&self.engine, tx_id.as_deref(), &document_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn documents_find_by_id(
    &self,
    tx_id: Option<String>,
    id: String,
  ) -> Result<Option<DocumentDto>> {
    documents::find_by_id(&self.engine, tx_id.as_deref(), &id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn documents_find_by_ids(
    &self,
    tx_id: Option<String>,
    ids: Vec<String>,
  ) -> Result<Vec<DocumentDto>> {
    documents::find_by_ids(&self.engine, tx_id.as_deref(), &ids)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn documents_insert(
    &self,
    tx_id: Option<String>,
    document: DocumentDto,
  ) -> Result<()> {
    documents::insert(&self.engine, tx_id.as_deref(), &document)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn documents_update(
    &self,
    tx_id: Option<String>,
    id: String,
    data: UpdateDocumentDataDto,
  ) -> Result<()> {
    documents::update(&self.engine, tx_id.as_deref(), &id, &data)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn documents_delete_by_id(
    &self,
    tx_id: Option<String>,
    id: String,
  ) -> Result<()> {
    documents::delete_by_id(&self.engine, tx_id.as_deref(), &id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn indexing_settings_get(
    &self,
    tx_id: Option<String>,
    scope_type: String,
    scope_id: String,
  ) -> Result<Option<IndexingSettingsDto>> {
    indexing_settings::get(&self.engine, tx_id.as_deref(), &scope_type, &scope_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn indexing_settings_get_many(
    &self,
    tx_id: Option<String>,
    scope_type: String,
    scope_ids: Vec<String>,
  ) -> Result<Vec<IndexingSettingsDto>> {
    indexing_settings::get_many(&self.engine, tx_id.as_deref(), &scope_type, &scope_ids)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn indexing_settings_upsert(
    &self,
    tx_id: Option<String>,
    input: UpsertIndexingSettingsDto,
  ) -> Result<IndexingSettingsDto> {
    indexing_settings::upsert(&self.engine, tx_id.as_deref(), &input)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn indexing_settings_delete(
    &self,
    tx_id: Option<String>,
    scope_type: String,
    scope_id: String,
  ) -> Result<()> {
    indexing_settings::delete(&self.engine, tx_id.as_deref(), &scope_type, &scope_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn job_queue_enqueue(
    &self,
    tx_id: Option<String>,
    input: EnqueueJobInputDto,
  ) -> Result<QueueJobDto> {
    job_queue::enqueue(&self.engine, tx_id.as_deref(), &input)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn job_queue_upsert_unique(
    &self,
    tx_id: Option<String>,
    input: UpsertUniqueJobInputDto,
  ) -> Result<QueueJobDto> {
    job_queue::upsert_unique(&self.engine, tx_id.as_deref(), &input)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn job_queue_lease(
    &self,
    tx_id: Option<String>,
    input: LeaseJobsInputDto,
  ) -> Result<Vec<QueueJobDto>> {
    job_queue::lease(&self.engine, tx_id.as_deref(), &input)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn job_queue_complete(
    &self,
    tx_id: Option<String>,
    input: CompleteLeasedJobInputDto,
  ) -> Result<String> {
    job_queue::complete(&self.engine, tx_id.as_deref(), &input)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn job_queue_fail(
    &self,
    tx_id: Option<String>,
    input: FailLeasedJobInputDto,
  ) -> Result<String> {
    job_queue::fail(&self.engine, tx_id.as_deref(), &input)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn job_queue_get_by_type_and_dedupe_key(
    &self,
    tx_id: Option<String>,
    job_type: String,
    dedupe_key: String,
  ) -> Result<Option<QueueJobDto>> {
    job_queue::get_by_type_and_dedupe_key(&self.engine, tx_id.as_deref(), &job_type, &dedupe_key)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn job_queue_get_by_type_and_dedupe_keys(
    &self,
    tx_id: Option<String>,
    job_type: String,
    dedupe_keys: Vec<String>,
  ) -> Result<Vec<QueueJobDto>> {
    job_queue::get_by_type_and_dedupe_keys(&self.engine, tx_id.as_deref(), &job_type, &dedupe_keys)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn job_queue_list_queued_by_type(
    &self,
    tx_id: Option<String>,
    job_type: String,
  ) -> Result<Vec<QueueJobDto>> {
    job_queue::list_queued_by_type(&self.engine, tx_id.as_deref(), &job_type)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn job_queue_delete_queued_by_type_and_dedupe_keys(
    &self,
    tx_id: Option<String>,
    job_type: String,
    dedupe_keys: Vec<String>,
  ) -> Result<()> {
    job_queue::delete_queued_by_type_and_dedupe_keys(&self.engine, tx_id.as_deref(), &job_type, &dedupe_keys)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn job_queue_get_type_stats(
    &self,
    tx_id: Option<String>,
    job_type: String,
  ) -> Result<JobQueueTypeStatsDto> {
    job_queue::get_type_stats(&self.engine, tx_id.as_deref(), &job_type)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn project_documents_insert(
    &self,
    tx_id: Option<String>,
    row: ProjectDocumentDto,
  ) -> Result<()> {
    project_documents::insert(&self.engine, tx_id.as_deref(), &row)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn project_documents_has_project_document(
    &self,
    tx_id: Option<String>,
    project_id: String,
    document_id: String,
  ) -> Result<bool> {
    project_documents::has_project_document(&self.engine, tx_id.as_deref(), &project_id, &document_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn project_documents_find_associated_document_ids(
    &self,
    tx_id: Option<String>,
    project_id: String,
    document_ids: Vec<String>,
  ) -> Result<Vec<String>> {
    project_documents::find_associated_document_ids(&self.engine, tx_id.as_deref(), &project_id, &document_ids)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn project_documents_list_document_ids(
    &self,
    tx_id: Option<String>,
  ) -> Result<Vec<String>> {
    project_documents::list_document_ids(&self.engine, tx_id.as_deref())
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn project_documents_find_sole_document_ids_by_project_id(
    &self,
    tx_id: Option<String>,
    project_id: String,
  ) -> Result<Vec<String>> {
    project_documents::find_sole_document_ids_by_project_id(&self.engine, tx_id.as_deref(), &project_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn project_documents_find_project_ids_by_document_id(
    &self,
    tx_id: Option<String>,
    document_id: String,
  ) -> Result<Vec<String>> {
    project_documents::find_project_ids_by_document_id(&self.engine, tx_id.as_deref(), &document_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn project_documents_find_sole_project_id_by_document_id(
    &self,
    tx_id: Option<String>,
    document_id: String,
  ) -> Result<Option<String>> {
    project_documents::find_sole_project_id_by_document_id(&self.engine, tx_id.as_deref(), &document_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn project_documents_find_sole_project_ids_by_document_ids(
    &self,
    tx_id: Option<String>,
    document_ids: Vec<String>,
  ) -> Result<HashMap<String, String>> {
    project_documents::find_sole_project_ids_by_document_ids(&self.engine, tx_id.as_deref(), &document_ids)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn projects_find_all(
    &self,
    tx_id: Option<String>,
  ) -> Result<Vec<ProjectDto>> {
    projects::find_all(&self.engine, tx_id.as_deref())
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn projects_find_by_owner_user_id(
    &self,
    tx_id: Option<String>,
    owner_user_id: String,
  ) -> Result<Vec<ProjectDto>> {
    projects::find_by_owner_user_id(&self.engine, tx_id.as_deref(), &owner_user_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn projects_find_by_id(
    &self,
    tx_id: Option<String>,
    id: String,
  ) -> Result<Option<ProjectDto>> {
    projects::find_by_id(&self.engine, tx_id.as_deref(), &id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn projects_find_by_ids(
    &self,
    tx_id: Option<String>,
    ids: Vec<String>,
  ) -> Result<Vec<ProjectDto>> {
    projects::find_by_ids(&self.engine, tx_id.as_deref(), &ids)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn projects_insert(
    &self,
    tx_id: Option<String>,
    project: ProjectDto,
  ) -> Result<()> {
    projects::insert(&self.engine, tx_id.as_deref(), &project)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn projects_update(
    &self,
    tx_id: Option<String>,
    id: String,
    data: UpdateProjectDataDto,
  ) -> Result<()> {
    projects::update(&self.engine, tx_id.as_deref(), &id, &data)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn projects_delete_by_id(
    &self,
    tx_id: Option<String>,
    id: String,
  ) -> Result<()> {
    projects::delete_by_id(&self.engine, tx_id.as_deref(), &id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn version_snapshots_find_by_id(
    &self,
    tx_id: Option<String>,
    id: String,
  ) -> Result<Option<VersionSnapshotDto>> {
    version_snapshots::find_by_id(&self.engine, tx_id.as_deref(), &id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn version_snapshots_find_metadata_by_document_id(
    &self,
    tx_id: Option<String>,
    document_id: String,
  ) -> Result<Vec<VersionSnapshotMetaDto>> {
    version_snapshots::find_metadata_by_document_id(&self.engine, tx_id.as_deref(), &document_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn version_snapshots_find_cursor_by_id(
    &self,
    tx_id: Option<String>,
    document_id: String,
    id: String,
  ) -> Result<Option<VersionSnapshotCursorDto>> {
    version_snapshots::find_cursor_by_id(&self.engine, tx_id.as_deref(), &document_id, &id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn version_snapshots_insert(
    &self,
    tx_id: Option<String>,
    snapshot: VersionSnapshotDto,
  ) -> Result<()> {
    version_snapshots::insert(&self.engine, tx_id.as_deref(), &snapshot)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn version_snapshots_delete_snapshots_after_cursor(
    &self,
    tx_id: Option<String>,
    document_id: String,
    cursor_created_at: i64,
    cursor_row_id: i64,
  ) -> Result<()> {
    version_snapshots::delete_snapshots_after_cursor(&self.engine, tx_id.as_deref(), &document_id, cursor_created_at, cursor_row_id)
      .await
      .map_err(to_napi_err)
  }
  #[napi]
  pub async fn persist_bundle(
    &self,
    tx_id: Option<String>,
    input: PersistBundleInputDto,
  ) -> Result<()> {
    persist_bundle::persist(&self.engine, tx_id.as_deref(), &input)
      .await
      .map_err(to_napi_err)
  }

  #[napi]
  pub async fn yjs_get_persisted(
    &self,
    tx_id: Option<String>,
    document_id: String,
  ) -> Result<Option<Buffer>> {
    yjs_documents::get_persisted(&self.engine, tx_id.as_deref(), &document_id)
      .await
      .map(|opt| opt.map(Buffer::from))
      .map_err(to_napi_err)
  }

  #[napi]
  pub async fn yjs_set(
    &self,
    tx_id: Option<String>,
    document_id: String,
    data: Buffer,
  ) -> Result<()> {
    yjs_documents::set(&self.engine, tx_id.as_deref(), &document_id, &data)
      .await
      .map_err(to_napi_err)
  }

  #[napi]
  pub async fn yjs_delete(
    &self,
    tx_id: Option<String>,
    document_id: String,
  ) -> Result<()> {
    yjs_documents::delete(&self.engine, tx_id.as_deref(), &document_id)
      .await
      .map_err(to_napi_err)
  }

  #[napi]
  pub async fn job_queue_wait_for_available(
    &self,
    tx_id: Option<String>,
    now: i64,
    timeout_ms: i64,
    types_json: Option<String>,
  ) -> Result<WaitForAvailableResult> {
    let reason = job_queue::wait_for_available(
      &self.engine,
      tx_id.as_deref(),
      now,
      timeout_ms,
      types_json.as_deref(),
    )
    .await
    .map_err(to_napi_err)?;
    Ok(WaitForAvailableResult { reason })
  }

  #[napi]
  pub async fn import_markdown_documents(&self, request: MassImportRequest) -> Result<String> {
    crate::import::import_markdown_documents(&self.engine, request).await
  }
}
