import type { DocumentAccessRole } from '@lucentdocs/shared'

export interface DocumentCollaborator {
  documentId: string
  userId: string
  role: DocumentAccessRole
  grantedByUserId: string
  grantSource: 'invite' | 'project_transfer' | 'ownership_transfer'
  createdAt: number
  updatedAt: number
}

export interface DocumentShareInvitation {
  id: string
  documentId: string
  recipientUserId: string
  role: DocumentAccessRole
  invitedByUserId: string
  createdAt: number
  acceptedAt: number | null
  declinedAt: number | null
  revokedAt: number | null
}

export interface DocumentCollaboratorsRepositoryPort {
  listForDocument(documentId: string): Promise<DocumentCollaborator[]>
  listForUser(userId: string): Promise<DocumentCollaborator[]>
  find(documentId: string, userId: string): Promise<DocumentCollaborator | undefined>
  upsert(row: DocumentCollaborator): Promise<void>
  delete(documentId: string, userId: string): Promise<void>
  insertInvitation(invitation: DocumentShareInvitation): Promise<void>
  listInvitationsForUser(userId: string): Promise<DocumentShareInvitation[]>
  findInvitation(id: string): Promise<DocumentShareInvitation | undefined>
  setInvitationState(
    id: string,
    state: 'acceptedAt' | 'declinedAt' | 'revokedAt',
    at: number
  ): Promise<void>
}
