import { nanoid } from 'nanoid'
import { isValidId, type JsonObject, type Project } from '@plotline/shared'
import * as dal from '../dal/projects.js'
import * as dalProjectDocs from '../dal/projectDocuments.js'
import * as docsRepo from './documents.js'
import { withTransaction } from '../transaction.js'
import { evictLiveDocument } from '../../yjs/server.js'

export async function createProject(title: string): Promise<Project> {
  const now = Date.now()
  const projectId = nanoid()

  const project: Project = {
    id: projectId,
    title,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  }

  await withTransaction(async () => {
    await dal.insert(project)
  })

  return project
}

export async function listProjects(): Promise<Project[]> {
  return dal.findAll()
}

export async function getProject(id: string): Promise<Project | null> {
  if (!isValidId(id)) return null

  return (await dal.findById(id)) ?? null
}

export async function updateProject(
  id: string,
  data: {
    title?: string
    metadata?: JsonObject | null
  }
): Promise<Project | null> {
  if (!isValidId(id)) return null

  const project = await dal.findById(id)
  if (!project) return null

  const updatedAt = Date.now()
  const nextProject: Project = {
    ...project,
    title: data.title ?? project.title,
    metadata: data.metadata === undefined ? project.metadata : data.metadata,
    updatedAt,
  }

  await dal.update(id, {
    title: data.title,
    metadata: data.metadata,
    updatedAt,
  })

  return nextProject
}

export async function hasProject(id: string): Promise<boolean> {
  if (!isValidId(id)) return false
  return (await dal.findById(id)) !== undefined
}

export async function deleteProject(id: string): Promise<boolean> {
  if (!isValidId(id)) return false

  const existing = await dal.findById(id)
  if (!existing) return false

  const deletedDocumentIds: string[] = []
  await withTransaction(async () => {
    const soleDocumentIds = await dalProjectDocs.findSoleDocumentIdsByProjectId(id)
    for (const documentId of soleDocumentIds) {
      const deleted = await docsRepo.deleteDocument(documentId, { evictLive: false })
      if (deleted) {
        deletedDocumentIds.push(documentId)
      }
    }

    await dal.deleteById(id)
  })

  for (const documentId of deletedDocumentIds) {
    evictLiveDocument(documentId)
  }

  return true
}
