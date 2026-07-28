import type { NativeStorageEngine } from '@lucentdocs/core'
import type {
  DocumentCollaborator,
  DocumentCollaboratorsRepositoryPort,
  DocumentShareInvitation,
} from '../../core/ports/documentCollaborators.port.js'
import { currentTxId } from './tx-scope.js'

function collaboratorFromDto(
  dto: import('@lucentdocs/core').DocumentCollaboratorDto
): DocumentCollaborator {
  return {
    documentId: dto.documentId,
    userId: dto.userId,
    role: dto.role as DocumentCollaborator['role'],
    grantedByUserId: dto.grantedByUserId,
    grantSource: dto.grantSource as DocumentCollaborator['grantSource'],
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

function invitationFromDto(
  dto: import('@lucentdocs/core').DocumentShareInvitationDto
): DocumentShareInvitation {
  return {
    id: dto.id,
    documentId: dto.documentId,
    recipientUserId: dto.recipientUserId,
    role: dto.role as DocumentShareInvitation['role'],
    invitedByUserId: dto.invitedByUserId,
    createdAt: dto.createdAt,
    acceptedAt: dto.acceptedAt ?? null,
    declinedAt: dto.declinedAt ?? null,
    revokedAt: dto.revokedAt ?? null,
  }
}

export class DocumentCollaboratorsRepository implements DocumentCollaboratorsRepositoryPort {
  constructor(private readonly engine: NativeStorageEngine) {}

  async listForDocument(documentId: string) {
    return (await this.engine.documentCollaboratorsListForDocument(currentTxId(), documentId)).map(
      collaboratorFromDto
    )
  }

  async listForUser(userId: string) {
    return (await this.engine.documentCollaboratorsListForUser(currentTxId(), userId)).map(
      collaboratorFromDto
    )
  }

  async find(documentId: string, userId: string) {
    const row = await this.engine.documentCollaboratorsFind(currentTxId(), documentId, userId)
    return row ? collaboratorFromDto(row) : undefined
  }

  async upsert(row: DocumentCollaborator) {
    await this.engine.documentCollaboratorsUpsert(currentTxId(), row)
  }

  async delete(documentId: string, userId: string) {
    await this.engine.documentCollaboratorsDelete(currentTxId(), documentId, userId)
  }

  async insertInvitation(row: DocumentShareInvitation) {
    await this.engine.documentShareInvitationsInsert(currentTxId(), {
      ...row,
      acceptedAt: row.acceptedAt ?? undefined,
      declinedAt: row.declinedAt ?? undefined,
      revokedAt: row.revokedAt ?? undefined,
    })
  }

  async listInvitationsForUser(userId: string) {
    return (await this.engine.documentShareInvitationsListForUser(currentTxId(), userId)).map(
      invitationFromDto
    )
  }

  async findInvitation(id: string) {
    const row = await this.engine.documentShareInvitationsFind(currentTxId(), id)
    return row ? invitationFromDto(row) : undefined
  }

  async setInvitationState(
    id: string,
    state: 'acceptedAt' | 'declinedAt' | 'revokedAt',
    at: number
  ) {
    await this.engine.documentShareInvitationsSetState(currentTxId(), id, state, at)
  }
}
