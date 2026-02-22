import { nanoid } from 'nanoid'

export type ProjectSyncPayload =
  | {
      projectId: string
      type: 'project.created'
    }
  | {
      projectId: string
      type: 'project.updated'
    }
  | {
      projectId: string
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

export type ProjectSyncEvent =
  | {
      id: string
      projectId: string
      createdAt: number
      type: 'project.created'
    }
  | {
      id: string
      projectId: string
      createdAt: number
      type: 'project.updated'
    }
  | {
      id: string
      projectId: string
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
