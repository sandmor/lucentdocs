import {
  CONFIG_FIELD_BY_KEY,
  indexingStrategySchema,
  normalizeCustomHeaders,
  PERSISTED_CONFIG_KEYS,
  type JsonObject,
  type PersistedAppConfig,
  type PersistedConfigKey,
} from '@lucentdocs/shared'
import type {
  AiApiKeyDto,
  AiModelSelectionDto,
  AiProviderConfigDto,
  AppConfigEntryDto,
  AuthInvitationDto,
  AuthSessionDto,
  AuthUserDto,
  ChatThreadDto,
  DocumentContentDto,
  DocumentDto,
  DocumentEmbeddingDto,
  DocumentNoteDto,
  DocumentVectorPayloadContextDto,
  EmbeddingSearchMatchDto,
  EmbeddingSearchMetadataDto,
  EmbeddingVectorReferenceDto,
  EnqueueJobInputDto,
  IndexingSettingsDto,
  ProjectDocumentDto,
  ProjectDto,
  QueueJobDto,
  ReplaceDocumentEmbeddingsInputDto,
  ReplaceDocumentEmbeddingsResultDto,
  ReplaceEmbeddingChunkDto,
  ReplaceEmbeddingMetadataChunkDto,
  SearchDocumentEmbeddingsInputDto,
  UpdateAiApiKeyDataDto,
  UpdateChatThreadDataDto,
  UpdateDocumentDataDto,
  UpdateProjectDataDto,
  UpsertAiModelSelectionDto,
  UpsertAiProviderConfigDto,
  UpsertIndexingSettingsDto,
  UpsertUniqueJobInputDto,
  VersionSnapshotCursorDto,
  VersionSnapshotDto,
  VersionSnapshotMetaDto,
} from '@lucentdocs/core'
import type { Project, Document, DocumentNoteRecord } from '@lucentdocs/shared'
import type { UpdateProjectData } from '../../core/ports/projects.port.js'
import type { UpdateDocumentData } from '../../core/ports/documents.port.js'
import type { ProjectDocumentRow } from '../../core/ports/projectDocuments.port.js'
import type {
  ChatThreadRow,
  UpdateChatThreadData,
} from '../../core/ports/chats.port.js'
import type {
  VersionSnapshotRow,
  VersionSnapshotMetaRow,
  VersionSnapshotCursorRow,
} from '../../core/ports/versionSnapshots.port.js'
import type {
  AuthInvitationEntity,
  AuthSessionEntity,
  AuthUserEntity,
  AuthUserRole,
} from '../../core/ports/authData.port.js'
import type {
  AiApiKeyEntity,
  AiProviderConfigEntity,
  UpdateAiApiKeyData,
  UpsertAiProviderConfigInput,
} from '../../core/ports/aiSettings.port.js'
import type { AiProviderUsage } from '../../core/ai/provider-usage.js'
import type {
  AiModelSelectionEntity,
  UpsertAiModelSelectionInput,
} from '../../core/ports/aiModelSelection.port.js'
import type {
  IndexingSettingsEntity,
  UpsertIndexingSettingsInput,
} from '../../core/ports/indexingSettings.port.js'
import type {
  DocumentEmbeddingEntity,
  DocumentEmbeddingVectorReference,
  ProjectDocumentEmbeddingSearchMatch,
  ReplaceDocumentEmbeddingChunkInput,
  ReplaceDocumentEmbeddingsInput,
  ReplaceDocumentEmbeddingsResult,
  SearchDocumentEmbeddingsInput,
  SearchProjectDocumentEmbeddingsInput,
} from '../../core/ports/documentEmbeddings.port.js'
import type {
  DocumentVectorPayloadContext,
  EmbeddingSearchMetadata,
  EmbeddingVectorReference,
  ReplaceEmbeddingMetadataChunkInput,
} from '../../core/ports/documentEmbeddingMetadata.port.js'
import type {
  EnqueueJobInput,
  QueueJobEnvelope,
  UpsertUniqueJobInput,
} from '../../core/ports/jobQueue.port.js'
import { normalizeModelSourceType, normalizeBaseURL } from '../../core/ai/provider-types.js'
import { isJsonObject } from '@lucentdocs/shared'

type PersistedConfigValue = PersistedAppConfig[PersistedConfigKey]

const persistedConfigKeySet = new Set<string>(PERSISTED_CONFIG_KEYS)

export function toJsonField(value: JsonObject | null): string | undefined {
  return value ? JSON.stringify(value) : undefined
}

export function fromJsonField(value: string | null | undefined): JsonObject | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return isJsonObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function toOptionalJsonField(
  value: JsonObject | null | undefined
): string | undefined | null {
  if (value === undefined) return undefined
  return value ? JSON.stringify(value) : null
}

export function nullToUndefined<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined
}

export function projectFromDto(dto: ProjectDto): Project {
  return {
    id: dto.id,
    title: dto.title,
    ownerUserId: dto.ownerUserId,
    metadata: fromJsonField(dto.metadataJson),
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

export function projectToDto(project: Project): ProjectDto {
  return {
    id: project.id,
    title: project.title,
    ownerUserId: project.ownerUserId,
    metadataJson: toJsonField(project.metadata),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
}

export function updateProjectToDto(_id: string, data: UpdateProjectData): UpdateProjectDataDto {
  const metadataJson = toOptionalJsonField(data.metadata)
  return {
    title: data.title,
    ownerUserId: data.ownerUserId,
    metadataJson: metadataJson === null ? undefined : metadataJson,
    clearMetadata: data.metadata !== undefined,
    updatedAt: data.updatedAt,
  }
}

export function documentFromDto(dto: DocumentDto): Document {
  return {
    id: dto.id,
    title: dto.title,
    type: dto.type,
    metadata: fromJsonField(dto.metadataJson),
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

export function documentToDto(document: Document): DocumentDto {
  return {
    id: document.id,
    title: document.title,
    type: document.type,
    metadataJson: toJsonField(document.metadata),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  }
}

export function updateDocumentToDto(_id: string, data: UpdateDocumentData): UpdateDocumentDataDto {
  const metadataJson = toOptionalJsonField(data.metadata)
  return {
    title: data.title,
    metadataJson: metadataJson === null ? undefined : metadataJson,
    clearMetadata: data.metadata !== undefined,
    updatedAt: data.updatedAt,
  }
}

export function projectDocumentFromDto(dto: ProjectDocumentDto): ProjectDocumentRow {
  return {
    projectId: dto.projectId,
    documentId: dto.documentId,
    addedAt: dto.addedAt,
  }
}

export function projectDocumentToDto(row: ProjectDocumentRow): ProjectDocumentDto {
  return {
    projectId: row.projectId,
    documentId: row.documentId,
    addedAt: row.addedAt,
  }
}

export function documentContentFromDto(dto: DocumentContentDto): {
  documentId: string
  content: string
  updatedAt: number
} {
  return {
    documentId: dto.documentId,
    content: dto.content,
    updatedAt: dto.updatedAt,
  }
}

export function documentNoteFromDto(dto: DocumentNoteDto): DocumentNoteRecord {
  return {
    id: dto.id,
    documentId: dto.documentId,
    anchorKind: dto.anchorKind as DocumentNoteRecord['anchorKind'],
    anchorId: dto.anchorId,
    content: dto.content,
    authorUserId: dto.authorUserId,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

export function documentNoteToDto(note: DocumentNoteRecord): DocumentNoteDto {
  return {
    id: note.id,
    documentId: note.documentId,
    anchorKind: note.anchorKind,
    anchorId: note.anchorId,
    content: note.content,
    authorUserId: note.authorUserId,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }
}

export function versionSnapshotFromDto(dto: VersionSnapshotDto): VersionSnapshotRow {
  return {
    id: dto.id,
    documentId: dto.documentId,
    content: dto.content,
    createdAt: dto.createdAt,
  }
}

export function versionSnapshotToDto(
  row: Omit<VersionSnapshotRow, 'createdAt'> & { createdAt?: number }
): VersionSnapshotDto {
  return {
    id: row.id,
    documentId: row.documentId,
    content: row.content,
    createdAt: row.createdAt ?? Date.now(),
  }
}

export function versionSnapshotMetaFromDto(dto: VersionSnapshotMetaDto): VersionSnapshotMetaRow {
  return {
    id: dto.id,
    documentId: dto.documentId,
    createdAt: dto.createdAt,
  }
}

export function versionSnapshotCursorFromDto(
  dto: VersionSnapshotCursorDto
): VersionSnapshotCursorRow {
  return {
    id: dto.id,
    documentId: dto.documentId,
    content: dto.content,
    createdAt: dto.createdAt,
    rowId: dto.rowId,
  }
}

export function chatThreadFromDto(dto: ChatThreadDto): ChatThreadRow {
  return {
    id: dto.id,
    projectId: dto.projectId,
    documentId: dto.documentId,
    title: dto.title,
    messages: dto.messages,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

export function chatThreadToDto(row: ChatThreadRow): ChatThreadDto {
  return {
    id: row.id,
    projectId: row.projectId,
    documentId: row.documentId,
    title: row.title,
    messages: row.messages,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function updateChatThreadToDto(data: UpdateChatThreadData): UpdateChatThreadDataDto {
  return {
    title: data.title,
    messages: data.messages,
    updatedAt: data.updatedAt,
  }
}

export function authUserFromDto(dto: AuthUserDto): AuthUserEntity {
  return {
    id: dto.id,
    name: dto.name,
    email: dto.email,
    passwordHash: dto.passwordHash,
    role: dto.role as AuthUserRole,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    lastLoginAt: dto.lastLoginAt ?? null,
  }
}

export function authUserToDto(user: AuthUserEntity): AuthUserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    passwordHash: user.passwordHash,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt ?? undefined,
  }
}

export function authInvitationFromDto(dto: AuthInvitationDto): AuthInvitationEntity {
  return {
    id: dto.id,
    token: dto.token,
    email: dto.email ?? null,
    role: dto.role as AuthUserRole,
    createdByUserId: dto.createdByUserId,
    createdAt: dto.createdAt,
    expiresAt: dto.expiresAt,
    revokedAt: dto.revokedAt ?? null,
    usedAt: dto.usedAt ?? null,
    usedByUserId: dto.usedByUserId ?? null,
  }
}

export function authInvitationToDto(invitation: AuthInvitationEntity): AuthInvitationDto {
  return {
    id: invitation.id,
    token: invitation.token,
    email: invitation.email ?? undefined,
    role: invitation.role,
    createdByUserId: invitation.createdByUserId,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    revokedAt: invitation.revokedAt ?? undefined,
    usedAt: invitation.usedAt ?? undefined,
    usedByUserId: invitation.usedByUserId ?? undefined,
  }
}

export function authSessionFromDto(dto: AuthSessionDto): AuthSessionEntity {
  return {
    token: dto.token,
    userId: dto.userId,
    createdAt: dto.createdAt,
    expiresAt: dto.expiresAt,
  }
}

export function authSessionToDto(session: AuthSessionEntity): AuthSessionDto {
  return {
    token: session.token,
    userId: session.userId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  }
}

export function aiProviderConfigFromDto(dto: AiProviderConfigDto): AiProviderConfigEntity {
  return {
    id: dto.id,
    usage: dto.usage as AiProviderUsage,
    name: dto.name ?? null,
    providerId: dto.providerId,
    type: normalizeModelSourceType(dto.type),
    baseURL: dto.baseUrl,
    model: dto.model,
    apiKeyId: dto.apiKeyId ?? null,
    customHeaders: normalizeCustomHeaders(dto.customHeadersJson),
    sortOrder: dto.sortOrder,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

export function upsertAiProviderConfigToDto(
  input: UpsertAiProviderConfigInput
): UpsertAiProviderConfigDto {
  return {
    id: input.id,
    usage: input.usage,
    name: input.name ?? undefined,
    providerId: input.providerId,
    type: input.type,
    baseUrl: input.baseURL,
    model: input.model,
    apiKeyId: input.apiKeyId ?? undefined,
    customHeadersJson: JSON.stringify(input.customHeaders),
    sortOrder: input.sortOrder,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  }
}

export function aiApiKeyFromDto(dto: AiApiKeyDto): AiApiKeyEntity {
  return {
    id: dto.id,
    baseURL: dto.baseUrl,
    name: dto.name,
    apiKey: dto.apiKey,
    isDefault: dto.isDefault,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

export function aiApiKeyToDto(apiKey: AiApiKeyEntity): AiApiKeyDto {
  return {
    id: apiKey.id,
    baseUrl: apiKey.baseURL,
    name: apiKey.name,
    apiKey: apiKey.apiKey,
    isDefault: apiKey.isDefault,
    createdAt: apiKey.createdAt,
    updatedAt: apiKey.updatedAt,
  }
}

export function updateAiApiKeyToDto(data: UpdateAiApiKeyData): UpdateAiApiKeyDataDto {
  return {
    name: data.name,
    apiKey: data.apiKey,
    updatedAt: data.updatedAt,
  }
}

export function aiModelSelectionFromDto(dto: AiModelSelectionDto): AiModelSelectionEntity {
  return {
    usage: dto.usage as AiModelSelectionEntity['usage'],
    scopeType: dto.scopeType as AiModelSelectionEntity['scopeType'],
    scopeId: dto.scopeId,
    providerConfigId: dto.providerConfigId,
    updatedAt: dto.updatedAt,
  }
}

export function upsertAiModelSelectionToDto(
  input: UpsertAiModelSelectionInput
): UpsertAiModelSelectionDto {
  return {
    usage: input.usage,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    providerConfigId: input.providerConfigId,
    updatedAt: input.updatedAt,
  }
}

export function indexingSettingsFromDto(dto: IndexingSettingsDto): IndexingSettingsEntity {
  return {
    scopeType: dto.scopeType as IndexingSettingsEntity['scopeType'],
    scopeId: dto.scopeId,
    strategy: indexingStrategySchema.parse({
      type: dto.strategyType,
      properties: fromJsonField(dto.strategyPropertiesJson) ?? {},
    }),
    updatedAt: dto.updatedAt,
  }
}

export function upsertIndexingSettingsToDto(
  input: UpsertIndexingSettingsInput
): UpsertIndexingSettingsDto {
  return {
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    strategyType: input.strategy.type,
    strategyPropertiesJson: JSON.stringify(input.strategy.properties),
    updatedAt: input.updatedAt,
  }
}

export function documentEmbeddingFromDto(dto: DocumentEmbeddingDto): DocumentEmbeddingEntity {
  return {
    id: dto.id,
    vectorKey: dto.vectorKey,
    documentId: dto.documentId,
    providerConfigId: dto.providerConfigId ?? null,
    providerId: dto.providerId,
    type: normalizeModelSourceType(dto.type),
    baseURL: dto.baseUrl,
    model: dto.model,
    strategy: indexingStrategySchema.parse({
      type: dto.strategyType,
      properties: fromJsonField(dto.strategyPropertiesJson) ?? {},
    }),
    chunkOrdinal: dto.chunkOrdinal,
    chunkStart: dto.chunkStart,
    chunkEnd: dto.chunkEnd,
    selectionFrom: dto.selectionFrom ?? null,
    selectionTo: dto.selectionTo ?? null,
    dimensions: dto.dimensions,
    documentTimestamp: dto.documentTimestamp,
    contentHash: dto.contentHash,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

export function embeddingVectorReferenceFromDto(
  dto: EmbeddingVectorReferenceDto
): EmbeddingVectorReference {
  return {
    vectorKey: dto.vectorKey,
    baseURL: dto.baseUrl,
    model: dto.model,
    dimensions: dto.dimensions,
  }
}

export function documentEmbeddingVectorReferenceFromDto(
  dto: EmbeddingVectorReferenceDto
): DocumentEmbeddingVectorReference {
  const reference: DocumentEmbeddingVectorReference = {
    documentId: dto.documentId,
    vectorKey: dto.vectorKey,
    baseURL: dto.baseUrl,
    model: dto.model,
    dimensions: dto.dimensions,
  }
  if (dto.vectorRowId !== undefined) {
    reference.vectorRowId = dto.vectorRowId
  }
  return reference
}

export function embeddingSearchMatchFromDto(
  dto: EmbeddingSearchMatchDto
): ProjectDocumentEmbeddingSearchMatch {
  return {
    documentId: dto.documentId,
    title: dto.title,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    strategyType: dto.strategyType as ProjectDocumentEmbeddingSearchMatch['strategyType'],
    chunkOrdinal: dto.chunkOrdinal,
    chunkStart: dto.chunkStart,
    chunkEnd: dto.chunkEnd,
    selectionFrom: dto.selectionFrom ?? null,
    selectionTo: dto.selectionTo ?? null,
    chunkText: dto.chunkText,
    distance: dto.distance,
  }
}

export function embeddingSearchMetadataFromDto(
  dto: EmbeddingSearchMetadataDto
): EmbeddingSearchMetadata {
  return {
    documentId: dto.documentId,
    title: dto.title,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    strategyType: dto.strategyType as EmbeddingSearchMetadata['strategyType'],
    chunkOrdinal: dto.chunkOrdinal,
    chunkStart: dto.chunkStart,
    chunkEnd: dto.chunkEnd,
    selectionFrom: dto.selectionFrom ?? null,
    selectionTo: dto.selectionTo ?? null,
    chunkText: dto.chunkText,
  }
}

export function replaceDocumentEmbeddingsToDto(
  input: ReplaceDocumentEmbeddingsInput
): ReplaceDocumentEmbeddingsInputDto {
  return {
    documentId: input.documentId,
    providerConfigId: input.providerConfigId ?? undefined,
    providerId: input.providerId,
    type: input.type,
    baseUrl: normalizeBaseURL(input.baseURL),
    model: input.model.trim(),
    strategyType: input.strategy.type,
    strategyPropertiesJson: JSON.stringify(input.strategy.properties),
    documentTimestamp: input.documentTimestamp,
    contentHash: input.contentHash,
    chunks: input.chunks.map(replaceEmbeddingChunkToDto),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  }
}

function replaceEmbeddingChunkToDto(
  chunk: ReplaceDocumentEmbeddingChunkInput
): ReplaceEmbeddingChunkDto {
  return {
    ordinal: chunk.ordinal,
    start: chunk.start,
    end: chunk.end,
    selectionFrom: chunk.selectionFrom ?? undefined,
    selectionTo: chunk.selectionTo ?? undefined,
    text: chunk.text,
    vectorKey: chunk.vectorKey,
    embeddingJson: JSON.stringify(chunk.embedding),
  }
}

export function replaceEmbeddingMetadataChunkToDto(
  chunk: ReplaceEmbeddingMetadataChunkInput
): ReplaceEmbeddingMetadataChunkDto {
  return {
    vectorKey: chunk.vectorKey,
    ordinal: chunk.ordinal,
    start: chunk.start,
    end: chunk.end,
    selectionFrom: chunk.selectionFrom ?? undefined,
    selectionTo: chunk.selectionTo ?? undefined,
    text: chunk.text,
    dimensions: chunk.dimensions,
  }
}

export function replaceDocumentEmbeddingsResultFromDto(
  dto: ReplaceDocumentEmbeddingsResultDto
): ReplaceDocumentEmbeddingsResult {
  return {
    status: dto.status === 'stale' ? 'stale' : 'applied',
    embeddings: dto.embeddings.map(documentEmbeddingFromDto),
  }
}

export function searchDocumentEmbeddingsToDto(
  input: SearchDocumentEmbeddingsInput
): SearchDocumentEmbeddingsInputDto {
  return {
    documentId: input.documentId,
    baseUrl: normalizeBaseURL(input.baseURL),
    model: input.model.trim(),
    queryEmbeddingJson: JSON.stringify(input.queryEmbedding),
    limit: input.limit,
    scopeType: 'document',
  }
}

export function searchProjectDocumentEmbeddingsToDto(
  input: SearchProjectDocumentEmbeddingsInput
): SearchDocumentEmbeddingsInputDto {
  const scopeType =
    input.scope.type === 'directory'
      ? 'directory'
      : input.scope.type === 'directory_subtree'
        ? 'directory_subtree'
        : 'project'

  return {
    projectId: input.projectId,
    baseUrl: normalizeBaseURL(input.baseURL),
    model: input.model.trim(),
    queryEmbeddingJson: JSON.stringify(input.queryEmbedding),
    limit: input.limit,
    scopeType,
    directoryPath:
      input.scope.type === 'directory' || input.scope.type === 'directory_subtree'
        ? input.scope.directoryPath
        : undefined,
  }
}

export function vectorPayloadContextFromDto(
  dto: DocumentVectorPayloadContextDto
): DocumentVectorPayloadContext {
  let projectIds: string[] = []
  let directoryAncestors: string[] = []

  try {
    const parsedProjectIds = JSON.parse(dto.projectIdsJson) as unknown
    if (Array.isArray(parsedProjectIds)) {
      projectIds = parsedProjectIds.filter((id): id is string => typeof id === 'string')
    }
  } catch {
    void 0
  }

  try {
    const parsedAncestors = JSON.parse(dto.directoryAncestorsJson) as unknown
    if (Array.isArray(parsedAncestors)) {
      directoryAncestors = parsedAncestors.filter(
        (value): value is string => typeof value === 'string'
      )
    }
  } catch {
    void 0
  }

  return {
    documentId: dto.documentId,
    parentDirectory: dto.parentDirectory,
    directoryAncestors,
    projectIds,
  }
}

export function queueJobFromDto<TPayload>(dto: QueueJobDto): QueueJobEnvelope<TPayload> {
  return {
    id: dto.id,
    type: dto.type,
    dedupeKey: dto.dedupeKey ?? null,
    payload: JSON.parse(dto.payloadJson) as TPayload,
    availableAt: dto.availableAt,
    leaseOwner: dto.leaseOwner ?? null,
    leaseUntil: dto.leaseUntil ?? null,
    attempt: dto.attempt,
    maxAttempts: dto.maxAttempts,
    priority: dto.priority,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    lastError: dto.lastError ?? null,
  }
}

export function enqueueJobToDto<TPayload>(input: EnqueueJobInput<TPayload>): EnqueueJobInputDto {
  return {
    type: input.type,
    dedupeKey: input.dedupeKey,
    payloadJson: JSON.stringify(input.payload),
    runAt: input.runAt,
    maxAttempts: input.maxAttempts,
    priority: input.priority,
  }
}

export function upsertUniqueJobToDto<TPayload>(
  input: UpsertUniqueJobInput<TPayload>
): UpsertUniqueJobInputDto {
  return {
    type: input.type,
    dedupeKey: input.dedupeKey,
    payloadJson: JSON.stringify(input.payload),
    runAt: input.runAt,
    maxAttempts: input.maxAttempts,
    priority: input.priority,
  }
}

function parseStoredConfigValue(
  key: PersistedConfigKey,
  rawValue: string
): PersistedConfigValue | undefined {
  const field = CONFIG_FIELD_BY_KEY[key]

  if (field.kind === 'string') {
    return rawValue
  }

  if (field.kind === 'boolean') {
    if (rawValue === '1' || rawValue.toLowerCase() === 'true') return true
    if (rawValue === '0' || rawValue.toLowerCase() === 'false') return false
    return undefined
  }

  if (field.kind === 'float') {
    const parsed = Number.parseFloat(rawValue)
    if (!Number.isFinite(parsed)) return undefined
    return parsed
  }

  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isInteger(parsed)) return undefined
  return parsed
}

function serializeStoredConfigValue(key: PersistedConfigKey, value: PersistedConfigValue): string {
  const field = CONFIG_FIELD_BY_KEY[key]

  if (field.kind === 'boolean') {
    return value ? '1' : '0'
  }

  return String(value)
}

export function appConfigFromEntries(entries: AppConfigEntryDto[]): Partial<PersistedAppConfig> {
  const persisted = {} as Partial<PersistedAppConfig>
  const persistedRecord = persisted as Partial<Record<PersistedConfigKey, PersistedConfigValue>>

  for (const entry of entries) {
    if (!persistedConfigKeySet.has(entry.key)) {
      continue
    }

    const key = entry.key as PersistedConfigKey
    const parsedValue = parseStoredConfigValue(key, entry.value)
    if (parsedValue === undefined) {
      continue
    }

    persistedRecord[key] = parsedValue
  }

  return persisted
}

export function appConfigToEntries(
  values: Partial<PersistedAppConfig>
): AppConfigEntryDto[] {
  return Object.entries(values)
    .filter((entry): entry is [PersistedConfigKey, PersistedConfigValue] => entry[1] !== undefined)
    .map(([key, value]) => ({
      key,
      value: serializeStoredConfigValue(key, value),
    }))
}

export function searchMetadataMapFromDto(
  record: Record<string, EmbeddingSearchMetadataDto>
): Map<string, EmbeddingSearchMetadata> {
  return new Map(
    Object.entries(record).map(([vectorKey, metadata]) => [
      vectorKey,
      embeddingSearchMetadataFromDto(metadata),
    ])
  )
}
