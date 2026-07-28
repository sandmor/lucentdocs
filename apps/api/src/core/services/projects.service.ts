import { nanoid } from 'nanoid'
import { isValidId, normalizeDocumentPath, type Document, type Project, type JsonObject } from '@lucentdocs/shared'
import type { RepositorySet } from '../../core/ports/types.js'
import type { TransactionPort } from '../../core/ports/transaction.port.js'

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
  getDeletionPlan(id: string): Promise<ProjectDeletionPlan | null>
  deleteWithPlan(input: {
    projectId: string
    targetOwnerUserId: string
    resolutions: ProjectDeletionResolution[]
  }): Promise<ProjectDeletionResult | null>
}

export interface ProjectDeletionPlan {
  project: Project
  homeDocuments: Array<{ document: Document; path: string }>
  foreignMounts: Array<{ document: Document; path: string }>
}

export type ProjectDeletionResolution =
  | { documentId: string; action: 'delete' }
  | { documentId: string; action: 'rehome'; projectId: string; path: string }

export interface ProjectDeletionResult {
  deletedDocumentIds: string[]
  rehomedDocumentIds: string[]
}

export function createProjectsService(
  repos: RepositorySet,
  transaction: TransactionPort,
  options: { deleteDocument?: (id: string) => Promise<boolean> } = {}
): ProjectsService {
  const getDeletionPlan = async (id: string): Promise<ProjectDeletionPlan | null> => {
    const project = await repos.projects.findById(id)
    if (!project) return null
    const mounts = await repos.projectDocuments.listByProject(id)
    const docs = await repos.documents.findByIds(mounts.map((mount) => mount.documentId))
    const documents = new Map(docs.map((document) => [document.id, document]))
    const homeDocuments: ProjectDeletionPlan['homeDocuments'] = []
    const foreignMounts: ProjectDeletionPlan['foreignMounts'] = []
    for (const mount of mounts) {
      const document = documents.get(mount.documentId)
      if (!document) continue
      const row = { document, path: mount.path }
      if (document.homeProjectId === id) homeDocuments.push(row)
      else foreignMounts.push(row)
    }
    return { project, homeDocuments, foreignMounts }
  }

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
      await transaction.run(async () => {
        const mounts = await repos.projectDocuments.listByProject(id)
        const documents = new Map(
          (await repos.documents.findByIds(mounts.map((mount) => mount.documentId))).map(
            (document) => [document.id, document]
          )
        )

        for (const mount of mounts) {
          const document = documents.get(mount.documentId)
          if (!document) continue
          if (document.homeProjectId === id) {
            // A new home-project owner is already an owner; a stale grant is
            // redundant and must not survive the ownership transition.
            await repos.documentCollaborators.delete(document.id, normalizedOwnerUserId)
            continue
          }

          // A foreign mount represents the prior owner's document capability,
          // never a capability that belongs to the project itself.
          await repos.projectDocuments.delete(id, document.id)
          const remainingMounts = await repos.projectDocuments.listByDocument(document.id)
          const previousOwnerStillUsesDocument = await Promise.all(
            remainingMounts.map(async (remaining) => {
              const remainingProject = await repos.projects.findById(remaining.projectId)
              return remainingProject?.ownerUserId === project.ownerUserId
            })
          )
          if (!previousOwnerStillUsesDocument.some(Boolean)) {
            await repos.documentCollaborators.delete(document.id, project.ownerUserId)
          }
        }

        await repos.projects.update(id, {
          ownerUserId: normalizedOwnerUserId,
          updatedAt,
        })
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

      await transaction.run(async () => {
        await repos.projects.deleteById(id)
      })

      return true
    },

    getDeletionPlan,

    async deleteWithPlan(input): Promise<ProjectDeletionResult | null> {
      if (!isValidId(input.projectId) || !input.targetOwnerUserId.trim()) return null
      const plan = await getDeletionPlan(input.projectId)
      if (!plan || plan.project.ownerUserId !== input.targetOwnerUserId) return null
      const resolutions = new Map(input.resolutions.map((resolution) => [resolution.documentId, resolution]))
      if (resolutions.size !== plan.homeDocuments.length || plan.homeDocuments.some(({ document }) => !resolutions.has(document.id))) {
        return null
      }

      const deletedDocumentIds: string[] = []
      const rehomedDocumentIds: string[] = []
      await transaction.run(async () => {
        // Validate every resolution before mutating. In particular, an error
        // in a later rehome must not partially delete an earlier home document.
        const targetPaths = new Map<string, Map<string, string>>()
        for (const { document } of plan.homeDocuments) {
          const resolution = resolutions.get(document.id)!
          if (resolution.action === 'delete') continue
          if (!isValidId(resolution.projectId) || resolution.projectId === input.projectId) {
            throw new Error('Invalid home-project destination')
          }
          const target = await repos.projects.findById(resolution.projectId)
          if (!target || target.ownerUserId !== input.targetOwnerUserId) {
            throw new Error('Destination project must be owned by the deleting project owner')
          }
          const path = normalizeDocumentPath(resolution.path)
          if (!path) throw new Error('A destination path is required')
          let paths = targetPaths.get(target.id)
          if (!paths) {
            paths = new Map((await repos.projectDocuments.listByProject(target.id)).map((mount) => [mount.path, mount.documentId]))
            targetPaths.set(target.id, paths)
          }
          const existingDocumentId = paths.get(path)
          if (existingDocumentId && existingDocumentId !== document.id) {
            throw new Error(`Path ${path} already exists in the destination project`)
          }
          paths.set(path, document.id)
        }

        for (const { document } of plan.homeDocuments) {
          const resolution = resolutions.get(document.id)!
          if (resolution.action === 'delete') {
            if (options.deleteDocument) await options.deleteDocument(document.id)
            else await repos.documents.deleteById(document.id)
            deletedDocumentIds.push(document.id)
            continue
          }

          if (!isValidId(resolution.projectId) || resolution.projectId === input.projectId) {
            throw new Error('Invalid home-project destination')
          }
          const target = await repos.projects.findById(resolution.projectId)
          if (!target || target.ownerUserId !== input.targetOwnerUserId) {
            throw new Error('Destination project must be owned by the deleting project owner')
          }
          const path = normalizeDocumentPath(resolution.path)
          if (!path) throw new Error('A destination path is required')
          const targetMounts = await repos.projectDocuments.listByProject(target.id)
          if (targetMounts.some((mount) => mount.path === path && mount.documentId !== document.id)) {
            throw new Error(`Path ${path} already exists in the destination project`)
          }
          const existingMount = targetMounts.find((mount) => mount.documentId === document.id)
          if (existingMount) {
            await repos.projectDocuments.updatePath(target.id, document.id, path, Date.now())
          } else {
            const now = Date.now()
            await repos.projectDocuments.insert({ projectId: target.id, documentId: document.id, path, addedByUserId: input.targetOwnerUserId, addedAt: now, updatedAt: now })
          }
          await repos.documents.update(document.id, { homeProjectId: target.id, updatedAt: Date.now() })
          rehomedDocumentIds.push(document.id)
        }
        await repos.projects.deleteById(input.projectId)
      })
      return { deletedDocumentIds, rehomedDocumentIds }
    },
  }
}
