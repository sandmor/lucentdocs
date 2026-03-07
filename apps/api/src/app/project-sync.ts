import { nanoid } from 'nanoid'

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
      reason:
        | 'documents.create'
        | 'documents.update'
        | 'documents.move'
        | 'documents.delete'
        | 'documents.create-directory'
        | 'documents.move-directory'
        | 'documents.delete-directory'
        | 'documents.set-default'
    }
  | {
      projectId: string
      type: 'chats.changed'
      documentId: string
      changedChatIds: string[]
      deletedChatIds: string[]
      reason: 'chats.create' | 'chats.update' | 'chats.delete'
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
      reason:
        | 'documents.create'
        | 'documents.update'
        | 'documents.move'
        | 'documents.delete'
        | 'documents.create-directory'
        | 'documents.move-directory'
        | 'documents.delete-directory'
        | 'documents.set-default'
    }
  | {
      id: string
      projectId: string
      createdAt: number
      type: 'chats.changed'
      documentId: string
      changedChatIds: string[]
      deletedChatIds: string[]
      reason: 'chats.create' | 'chats.update' | 'chats.delete'
    }

type ProjectSyncListener = (event: ProjectSyncEvent) => void

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
