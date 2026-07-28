import { nanoid } from 'nanoid'
import type { Document, DocumentAccessRole } from '@lucentdocs/shared'
import type { RepositorySet } from '../ports/types.js'
import type { TransactionPort } from '../ports/transaction.port.js'
import type {
  DocumentCollaborator,
  DocumentShareInvitation,
} from '../ports/documentCollaborators.port.js'

export type DocumentEffectiveRole = 'owner' | DocumentAccessRole | null
export type AcceptInvitationResult =
  | { status: 'accepted'; invitation: DocumentShareInvitation }
  | {
      status:
        | 'not_found'
        | 'inactive'
        | 'destination_not_found'
        | 'destination_not_owned'
        | 'path_conflict'
        | 'already_mounted'
    }

export interface DocumentSharingService {
  getEffectiveRole(documentId: string, userId: string): Promise<DocumentEffectiveRole>
  listCollaborators(documentId: string): Promise<DocumentCollaborator[]>
  listInvitationsForUser(userId: string): Promise<DocumentShareInvitation[]>
  listMountedProjectIds(documentId: string): Promise<string[]>
  invite(input: {
    documentId: string
    recipientUserId: string
    role: DocumentAccessRole
    invitedByUserId: string
  }): Promise<DocumentShareInvitation | null>
  acceptInvitation(input: {
    invitationId: string
    userId: string
    projectId: string
    path: string
  }): Promise<AcceptInvitationResult>
  declineInvitation(invitationId: string, userId: string): Promise<DocumentShareInvitation | null>
  revokeInvitation(invitationId: string, actingUserId: string): Promise<boolean>
  changeRole(input: {
    documentId: string
    userId: string
    role: DocumentAccessRole
    actingUserId: string
  }): Promise<boolean>
  revokeAccess(input: {
    documentId: string
    userId: string
    actingUserId: string
  }): Promise<boolean>
  leave(documentId: string, userId: string): Promise<boolean>
  transferOwnership(input: {
    documentId: string
    recipientUserId: string
    recipientProjectId: string
    actingUserId: string
  }): Promise<Document | null>
}

function canManage(role: DocumentEffectiveRole): boolean {
  return role === 'owner'
}

export function createDocumentSharingService(
  repos: RepositorySet,
  transaction: TransactionPort
): DocumentSharingService {
  async function roleFor(documentId: string, userId: string): Promise<DocumentEffectiveRole> {
    const document = await repos.documents.findById(documentId)
    if (!document) return null
    const homeProject = await repos.projects.findById(document.homeProjectId)
    if (homeProject?.ownerUserId === userId) return 'owner'
    return (await repos.documentCollaborators.find(documentId, userId))?.role ?? null
  }

  async function assertOwner(documentId: string, userId: string): Promise<Document | null> {
    const document = await repos.documents.findById(documentId)
    if (!document || !canManage(await roleFor(documentId, userId))) return null
    return document
  }

  return {
    getEffectiveRole: roleFor,
    listCollaborators: (documentId) => repos.documentCollaborators.listForDocument(documentId),
    listInvitationsForUser: (userId) => repos.documentCollaborators.listInvitationsForUser(userId),
    async listMountedProjectIds(documentId) {
      return (await repos.projectDocuments.listByDocument(documentId)).map(
        (mount) => mount.projectId
      )
    },

    async invite(input) {
      const document = await assertOwner(input.documentId, input.invitedByUserId)
      const homeProject = document && (await repos.projects.findById(document.homeProjectId))
      if (!document || homeProject?.ownerUserId === input.recipientUserId) return null
      const existing = await repos.documentCollaborators.find(
        input.documentId,
        input.recipientUserId
      )
      if (existing) return null
      const now = Date.now()
      const invitation: DocumentShareInvitation = {
        id: nanoid(),
        documentId: input.documentId,
        recipientUserId: input.recipientUserId,
        role: input.role,
        invitedByUserId: input.invitedByUserId,
        createdAt: now,
        acceptedAt: null,
        declinedAt: null,
        revokedAt: null,
      }
      await repos.documentCollaborators.insertInvitation(invitation)
      return invitation
    },

    async acceptInvitation(input) {
      const invitation = await repos.documentCollaborators.findInvitation(input.invitationId)
      const project = await repos.projects.findById(input.projectId)
      // Do not reveal whether an invitation belongs to someone else.
      if (!invitation || invitation.recipientUserId !== input.userId) return { status: 'not_found' }
      if (invitation.acceptedAt || invitation.declinedAt || invitation.revokedAt)
        return { status: 'inactive' }
      if (!project) return { status: 'destination_not_found' }
      if (project.ownerUserId !== input.userId) return { status: 'destination_not_owned' }
      const existing = await repos.projectDocuments.listByProject(input.projectId)
      if (existing.some((mount) => mount.documentId === invitation.documentId))
        return { status: 'already_mounted' }
      if (
        existing.some(
          (mount) => mount.path === input.path && mount.documentId !== invitation.documentId
        )
      )
        return { status: 'path_conflict' }
      const now = Date.now()
      await transaction.run(async () => {
        await repos.documentCollaborators.upsert({
          documentId: invitation.documentId,
          userId: input.userId,
          role: invitation.role,
          grantedByUserId: invitation.invitedByUserId,
          grantSource: 'invite',
          createdAt: now,
          updatedAt: now,
        })
        await repos.projectDocuments.insert({
          projectId: input.projectId,
          documentId: invitation.documentId,
          path: input.path,
          addedByUserId: input.userId,
          addedAt: now,
          updatedAt: now,
        })
        await repos.documentCollaborators.setInvitationState(input.invitationId, 'acceptedAt', now)
      })
      return { status: 'accepted', invitation: { ...invitation, acceptedAt: now } }
    },

    async declineInvitation(invitationId, userId) {
      const invitation = await repos.documentCollaborators.findInvitation(invitationId)
      if (
        !invitation ||
        invitation.recipientUserId !== userId ||
        invitation.acceptedAt ||
        invitation.declinedAt ||
        invitation.revokedAt
      )
        return null
      const now = Date.now()
      await repos.documentCollaborators.setInvitationState(invitationId, 'declinedAt', now)
      return { ...invitation, declinedAt: now }
    },

    async revokeInvitation(invitationId, actingUserId) {
      const invitation = await repos.documentCollaborators.findInvitation(invitationId)
      if (!invitation || invitation.acceptedAt || invitation.declinedAt || invitation.revokedAt)
        return false
      if (!(await assertOwner(invitation.documentId, actingUserId))) return false
      await repos.documentCollaborators.setInvitationState(invitationId, 'revokedAt', Date.now())
      return true
    },

    async changeRole(input) {
      if (!(await assertOwner(input.documentId, input.actingUserId))) return false
      const collaborator = await repos.documentCollaborators.find(input.documentId, input.userId)
      if (!collaborator) return false
      await repos.documentCollaborators.upsert({
        ...collaborator,
        role: input.role,
        updatedAt: Date.now(),
      })
      return true
    },

    async revokeAccess(input) {
      if (!(await assertOwner(input.documentId, input.actingUserId))) return false
      if (!(await repos.documentCollaborators.find(input.documentId, input.userId))) return false
      await transaction.run(async () => {
        const mounts = await repos.projectDocuments.listByDocument(input.documentId)
        for (const mount of mounts) {
          const project = await repos.projects.findById(mount.projectId)
          if (project?.ownerUserId === input.userId) {
            await repos.projectDocuments.delete(mount.projectId, input.documentId)
          }
        }
        await repos.documentCollaborators.delete(input.documentId, input.userId)
      })
      return true
    },

    async leave(documentId, userId) {
      const document = await repos.documents.findById(documentId)
      const homeProject = document && (await repos.projects.findById(document.homeProjectId))
      if (
        !document ||
        homeProject?.ownerUserId === userId ||
        !(await repos.documentCollaborators.find(documentId, userId))
      )
        return false
      await transaction.run(async () => {
        const mounts = await repos.projectDocuments.listByDocument(documentId)
        for (const mount of mounts) {
          const project = await repos.projects.findById(mount.projectId)
          if (project?.ownerUserId === userId)
            await repos.projectDocuments.delete(mount.projectId, documentId)
        }
        await repos.documentCollaborators.delete(documentId, userId)
      })
      return true
    },

    async transferOwnership(input) {
      const document = await assertOwner(input.documentId, input.actingUserId)
      const recipientProject = await repos.projects.findById(input.recipientProjectId)
      if (
        !document ||
        !recipientProject ||
        recipientProject.ownerUserId !== input.recipientUserId ||
        document.homeProjectId === input.recipientProjectId
      )
        return null
      const recipientRole = await roleFor(input.documentId, input.recipientUserId)
      if (!recipientRole) return null
      const now = Date.now()
      await transaction.run(async () => {
        const mounts = await repos.projectDocuments.listByProject(input.recipientProjectId)
        if (!mounts.some((mount) => mount.documentId === input.documentId)) {
          const currentHomeMount = (
            await repos.projectDocuments.listByDocument(input.documentId)
          ).find((mount) => mount.projectId === document.homeProjectId)
          await repos.projectDocuments.insert({
            projectId: input.recipientProjectId,
            documentId: input.documentId,
            path: currentHomeMount?.path ?? document.title,
            addedByUserId: input.recipientUserId,
            addedAt: now,
            updatedAt: now,
          })
        }
        await repos.documents.update(input.documentId, {
          homeProjectId: input.recipientProjectId,
          updatedAt: now,
        })
        await repos.documentCollaborators.delete(input.documentId, input.recipientUserId)
        const previousHome = await repos.projects.findById(document.homeProjectId)
        if (previousHome)
          await repos.documentCollaborators.upsert({
            documentId: input.documentId,
            userId: previousHome.ownerUserId,
            role: 'editor',
            grantedByUserId: input.recipientUserId,
            grantSource: 'ownership_transfer',
            createdAt: now,
            updatedAt: now,
          })
      })
      return { ...document, homeProjectId: input.recipientProjectId, updatedAt: now }
    },
  }
}
