import { nanoid } from 'nanoid'
import { isValidId, type Project, type JsonObject } from '@lucentdocs/shared'
import type { RepositorySet } from '../../core/ports/types.js'
import type { TransactionPort } from '../../core/ports/transaction.port.js'
import type { DocumentEmbeddingVectorReference } from '../ports/documentEmbeddings.port.js'
import { createDocumentDeletionDispatcher } from './document-deletion-dispatch.js'

interface ProjectContentObserver {
  onDocumentDeleted?(
    documentId: string,
    references?: DocumentEmbeddingVectorReference[]
  ): Promise<void> | void
  onDocumentsDeleted?(
    documentIds: string[],
    references?: DocumentEmbeddingVectorReference[]
  ): Promise<void> | void
}

export interface ProjectsService {
  create(title: string, options: { ownerUserId: string }): Promise<Project>
  list(): Promise<Project[]>
  listOwnedByUser(ownerUserId: string): Promise<Project[]>
  getById(id: string): Promise<Project | null>
  reassignOwner(id: string, ownerUserId: string): Promise<Project | null>
  update(
    id: string,
    data: { title?: string; metadata?: JsonObject | null }
  ): Promise<Project | null>
  has(id: string): Promise<boolean>
  delete(id: string): Promise<boolean>
}

export function createProjectsService(
  repos: RepositorySet,
  transaction: TransactionPort,
  observer: ProjectContentObserver = {}
): ProjectsService {
  const { dispatchDocumentsDeleted } = createDocumentDeletionDispatcher(observer, {
    logLabel: 'projects',
  })

  return {
    async create(title: string, options: { ownerUserId: string }): Promise<Project> {
      const now = Date.now()
      const projectId = nanoid()
      const ownerUserId = options.ownerUserId.trim()
      if (!ownerUserId) {
        throw new Error('Project owner user ID is required.')
      }

      const project: Project = {
        id: projectId,
        title,
        ownerUserId,
        metadata: null,
        createdAt: now,
        updatedAt: now,
      }

      await transaction.run(async () => {
        await repos.projects.insert(project)
      })

      return project
    },

    async list(): Promise<Project[]> {
      return repos.projects.findAll()
    },

    async listOwnedByUser(ownerUserId: string): Promise<Project[]> {
      const normalizedOwnerUserId = ownerUserId.trim()
      if (!normalizedOwnerUserId) return []
      return repos.projects.findByOwnerUserId(normalizedOwnerUserId)
    },

    async getById(id: string): Promise<Project | null> {
      if (!isValidId(id)) return null
      return (await repos.projects.findById(id)) ?? null
    },

    async reassignOwner(id: string, ownerUserId: string): Promise<Project | null> {
      if (!isValidId(id)) return null

      const normalizedOwnerUserId = ownerUserId.trim()
      if (!normalizedOwnerUserId) return null

      const project = await repos.projects.findById(id)
      if (!project) return null
      if (project.ownerUserId === normalizedOwnerUserId) return project

      const updatedAt = Date.now()
      await repos.projects.update(id, {
        ownerUserId: normalizedOwnerUserId,
        updatedAt,
      })

      return {
        ...project,
        ownerUserId: normalizedOwnerUserId,
        updatedAt,
      }
    },

    async update(
      id: string,
      data: { title?: string; metadata?: JsonObject | null }
    ): Promise<Project | null> {
      if (!isValidId(id)) return null

      const project = await repos.projects.findById(id)
      if (!project) return null

      const updatedAt = Date.now()
      const nextProject: Project = {
        ...project,
        title: data.title ?? project.title,
        metadata: data.metadata === undefined ? project.metadata : data.metadata,
        updatedAt,
      }

      await repos.projects.update(id, {
        title: data.title,
        metadata: data.metadata,
        updatedAt,
      })

      return nextProject
    },

    async has(id: string): Promise<boolean> {
      if (!isValidId(id)) return false
      return (await repos.projects.findById(id)) !== undefined
    },

    async delete(id: string): Promise<boolean> {
      if (!isValidId(id)) return false

      const existing = await repos.projects.findById(id)
      if (!existing) return false

      const { deletedDocumentIds, references } = await transaction.run(async () => {
        const soleDocumentIds = await repos.projectDocuments.findSoleDocumentIdsByProjectId(id)
        const capturedReferences =
          await repos.documentEmbeddings.listVectorReferencesByDocumentIds(soleDocumentIds)

        for (const documentId of soleDocumentIds) {
          await repos.documents.deleteById(documentId)
          await repos.yjsDocuments.delete(documentId)
        }

        await repos.projects.deleteById(id)

        return {
          deletedDocumentIds: soleDocumentIds,
          references: capturedReferences,
        }
      })

      dispatchDocumentsDeleted(deletedDocumentIds, references)

      return true
    },
  }
}
