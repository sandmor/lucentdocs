import { nanoid } from 'nanoid'

export const DOCUMENTS_CHANGED_REASONS = [
  'documents.create',
  'documents.update',
  'documents.move',
  'documents.delete',
  'documents.import-many',
  'documents.import-split',
  'documents.create-directory',
  'documents.move-directory',
  'documents.delete-directory',
  'documents.set-default',
] as const

export type DocumentsChangedReason = (typeof DOCUMENTS_CHANGED_REASONS)[number]

export const CHATS_CHANGED_REASONS = ['chats.create', 'chats.update', 'chats.delete'] as const
export type ChatsChangedReason = (typeof CHATS_CHANGED_REASONS)[number]

export type ProjectSyncPayload =
  | {
      audienceUserIds: string[]
      projectId: string
      ownerUserId: string
      type: 'project.created'
    }
  | {
      audienceUserIds: string[]
      projectId: string
      ownerUserId: string
      type: 'project.updated'
    }
  | {
      audienceUserIds: string[]
      projectId: string
      ownerUserId: string
      type: 'project.deleted'
    }
  | {
      projectId: string
      type: 'documents.changed'
      changedDocumentIds: string[]
      deletedDocumentIds: string[]
      defaultDocumentId: string | null
      reason: DocumentsChangedReason
    }
  | {
      projectId: string
      type: 'chats.changed'
      documentId: string
      changedChatIds: string[]
      deletedChatIds: string[]
      reason: ChatsChangedReason
    }

export type ProjectSyncEvent =
  | {
      audienceUserIds: string[]
      id: string
      projectId: string
      ownerUserId: string
      createdAt: number
      type: 'project.created'
    }
  | {
      audienceUserIds: string[]
      id: string
      projectId: string
      ownerUserId: string
      createdAt: number
      type: 'project.updated'
    }
  | {
      audienceUserIds: string[]
      id: string
      projectId: string
      ownerUserId: string
      createdAt: number
      type: 'project.deleted'
    }
  | {
      id: string
      projectId: string
      createdAt: number
      type: 'documents.changed'
      changedDocumentIds: string[]
      deletedDocumentIds: string[]
      defaultDocumentId: string | null
      reason: DocumentsChangedReason
    }
  | {
      id: string
      projectId: string
      createdAt: number
      type: 'chats.changed'
      documentId: string
      changedChatIds: string[]
      deletedChatIds: string[]
      reason: ChatsChangedReason
    }

type ProjectSyncListener = (event: ProjectSyncEvent) => void

/**
 * In-process fan-out bus for project-level invalidation events.
 *
 * Events are ephemeral and only reach current subscribers. Reconnecting clients
 * still need to re-read storage to rebuild state after missing a publication.
 */
class ProjectSyncBus {
  private listeners = new Set<ProjectSyncListener>()

  subscribe(listener: ProjectSyncListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  publish(event: ProjectSyncPayload): ProjectSyncEvent {
    const finalizedEvent: ProjectSyncEvent = {
      ...event,
      id: nanoid(),
      createdAt: Date.now(),
    }

    for (const listener of this.listeners) {
      listener(finalizedEvent)
    }

    return finalizedEvent
  }
}

export const projectSyncBus = new ProjectSyncBus()
