import { describe, expect, test } from 'bun:test'
import { createTestAdapter } from '../../testing/factory.js'

describe('document sharing lifecycle', () => {
  test('shares one canonical document into another user project and removes every recipient mount on revocation', async () => {
    const adapter = createTestAdapter()
    try {
      const ownerProject = await adapter.services.projects.create('Owner project', {
        ownerUserId: 'owner',
      })
      const recipientProject = await adapter.services.projects.create('Recipient project', {
        ownerUserId: 'recipient',
      })
      const document = await adapter.services.documents.createForProject(
        ownerProject.id,
        'chapters/original.md'
      )
      expect(document).not.toBeNull()
      if (!document) return

      const invitation = await adapter.services.documentSharing.invite({
        documentId: document.id,
        recipientUserId: 'recipient',
        role: 'editor',
        invitedByUserId: 'owner',
      })
      expect(invitation).not.toBeNull()
      if (!invitation) return

      const accepted = await adapter.services.documentSharing.acceptInvitation({
        invitationId: invitation.id,
        userId: 'recipient',
        projectId: recipientProject.id,
        path: 'research/shared-copy.md',
      })
      expect(accepted).toMatchObject({ status: 'accepted' })
      expect(accepted.status === 'accepted' && accepted.invitation.acceptedAt).not.toBeNull()
      expect(
        await adapter.services.documents.getForProject(recipientProject.id, document.id)
      ).toMatchObject({
        id: document.id,
        path: 'research/shared-copy.md',
        homeProjectId: ownerProject.id,
      })

      expect(
        await adapter.services.documentSharing.revokeAccess({
          documentId: document.id,
          userId: 'recipient',
          actingUserId: 'owner',
        })
      ).toBe(true)
      expect(
        await adapter.services.documents.getForProject(recipientProject.id, document.id)
      ).toBeNull()
      expect(
        await adapter.services.documents.getForProject(ownerProject.id, document.id)
      ).not.toBeNull()
    } finally {
      await adapter.adapter.engine.close()
    }
  })

  test('does not let a foreign user act as an owner or accept into another user project', async () => {
    const adapter = createTestAdapter()
    try {
      const ownerProject = await adapter.services.projects.create('Owner project', {
        ownerUserId: 'owner',
      })
      const recipientProject = await adapter.services.projects.create('Recipient project', {
        ownerUserId: 'recipient',
      })
      const foreignProject = await adapter.services.projects.create('Foreign project', {
        ownerUserId: 'admin',
      })
      const document = await adapter.services.documents.createForProject(
        ownerProject.id,
        'original.md'
      )
      expect(document).not.toBeNull()
      if (!document) return

      expect(
        await adapter.services.documentSharing.getEffectiveRole(document.id, 'admin')
      ).toBeNull()
      expect(
        await adapter.services.documentSharing.invite({
          documentId: document.id,
          recipientUserId: 'recipient',
          role: 'viewer',
          invitedByUserId: 'admin',
        })
      ).toBeNull()

      const invitation = await adapter.services.documentSharing.invite({
        documentId: document.id,
        recipientUserId: 'recipient',
        role: 'viewer',
        invitedByUserId: 'owner',
      })
      expect(invitation).not.toBeNull()
      if (!invitation) return

      expect(
        await adapter.services.documentSharing.acceptInvitation({
          invitationId: invitation.id,
          userId: 'recipient',
          projectId: foreignProject.id,
          path: 'shared.md',
        })
      ).toEqual({ status: 'destination_not_owned' })
      expect(
        await adapter.services.documentSharing.acceptInvitation({
          invitationId: invitation.id,
          userId: 'recipient',
          projectId: recipientProject.id,
          path: 'shared.md',
        })
      ).toMatchObject({ status: 'accepted' })
    } finally {
      await adapter.adapter.engine.close()
    }
  })

  test('detaches foreign mounts and stale grants when a project is reassigned', async () => {
    const adapter = createTestAdapter()
    try {
      const source = await adapter.services.projects.create('Source', { ownerUserId: 'owner' })
      const reassigned = await adapter.services.projects.create('Transferred', {
        ownerUserId: 'previous-owner',
      })
      const document = await adapter.services.documents.createForProject(source.id, 'source.md')
      if (!document) throw new Error('Expected source document.')

      const invitation = await adapter.services.documentSharing.invite({
        documentId: document.id,
        recipientUserId: 'previous-owner',
        role: 'viewer',
        invitedByUserId: 'owner',
      })
      if (!invitation) throw new Error('Expected invitation.')
      expect(
        await adapter.services.documentSharing.acceptInvitation({
          invitationId: invitation.id,
          userId: 'previous-owner',
          projectId: reassigned.id,
          path: 'shared/source.md',
        })
      ).toMatchObject({ status: 'accepted' })

      await adapter.services.projects.reassignOwner(reassigned.id, 'next-owner')

      expect(await adapter.services.documents.getForProject(reassigned.id, document.id)).toBeNull()
      expect(
        await adapter.services.documentSharing.getEffectiveRole(document.id, 'previous-owner')
      ).toBeNull()
      expect(await adapter.services.documents.getForProject(source.id, document.id)).not.toBeNull()
    } finally {
      await adapter.adapter.engine.close()
    }
  })
})
