import { nanoid } from 'nanoid'
import { isValidId, type JsonObject, type Project } from '@plotline/shared'
import * as dal from '../dal/projects.js'
import * as dalProjectDocs from '../dal/projectDocuments.js'
import * as docsRepo from './documents.js'
import type { DocumentWithContent, VersionSnapshot } from './documents.js'
import { withTransaction } from '../transaction.js'
import {
  evictLiveDocument,
  YJS_RESTORE_CLOSE_CODE,
  YJS_RESTORE_CLOSE_REASON,
} from '../../yjs/server.js'

export interface ProjectWithContent extends Project {
  documentId: string
  content: string
}

function docToProjectWithContent(doc: DocumentWithContent, project: Project): ProjectWithContent {
  return {
    id: project.id,
    documentId: doc.id,
    title: doc.title,
    metadata: project.metadata,
    createdAt: project.createdAt,
    updatedAt: doc.updatedAt,
    content: doc.content,
  }
}

export async function createProject(title: string): Promise<ProjectWithContent> {
  const now = Date.now()
  const projectId = nanoid()

  const project: Project = {
    id: projectId,
    title,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  }

  const result = await withTransaction(async () => {
    await dal.insert(project)
    const doc = await docsRepo.createDocument(title)
    await dalProjectDocs.insert({
      projectId,
      documentId: doc.id,
      addedAt: now,
    })
    return doc
  })

  return {
    ...project,
    documentId: result.id,
    content: result.content,
  }
}

export async function listProjects(): Promise<ProjectWithContent[]> {
  const projects = await dal.findAll()
  if (projects.length === 0) return []

  const projectDocs = await dalProjectDocs.findLatestDocumentsByProjectIds(
    projects.map((project) => project.id)
  )
  if (projectDocs.length === 0) return []

  const documentIds = projectDocs.map((row) => row.documentId)
  const docsById = await docsRepo.getDocumentsWithContent(documentIds)
  const documentIdByProjectId = new Map(projectDocs.map((row) => [row.projectId, row.documentId]))

  return projects.flatMap((project) => {
    const documentId = documentIdByProjectId.get(project.id)
    if (!documentId) return []

    const doc = docsById.get(documentId)
    if (!doc) return []

    return [docToProjectWithContent(doc, project)]
  })
}

export async function getProject(id: string): Promise<ProjectWithContent | null> {
  if (!isValidId(id)) return null

  const project = await dal.findById(id)
  if (!project) return null

  const projectDoc = await dalProjectDocs.findDocumentByProjectId(id)
  if (!projectDoc) return null

  const doc = await docsRepo.getDocumentWithContent(projectDoc.documentId)
  if (!doc) return null

  return docToProjectWithContent(doc, project)
}

export async function updateProject(
  id: string,
  data: {
    title?: string
    metadata?: JsonObject | null
  }
): Promise<ProjectWithContent | null> {
  if (!isValidId(id)) return null

  return withTransaction(async () => {
    const project = await dal.findById(id)
    if (!project) return null

    const projectDoc = await dalProjectDocs.findDocumentByProjectId(id)
    if (!projectDoc) return null

    const doc = await docsRepo.updateDocument(projectDoc.documentId, {
      title: data.title,
      metadata: data.metadata,
    })

    if (!doc) return null

    const nextProject: Project = {
      ...project,
      title: data.title ?? project.title,
      metadata: data.metadata === undefined ? project.metadata : data.metadata,
      updatedAt: doc.updatedAt,
    }

    await dal.update(id, {
      title: data.title,
      metadata: data.metadata,
      updatedAt: doc.updatedAt,
    })

    return docToProjectWithContent(doc, nextProject)
  })
}

export async function restoreProject(
  id: string,
  snapshotId: string
): Promise<ProjectWithContent | null> {
  if (!isValidId(id)) return null

  let restoredDocumentId: string | null = null
  const restored = await withTransaction(async () => {
    const project = await dal.findById(id)
    if (!project) return null

    const projectDoc = await dalProjectDocs.findDocumentByProjectId(id)
    if (!projectDoc) return null
    restoredDocumentId = projectDoc.documentId

    const doc = await docsRepo.restoreToSnapshot(projectDoc.documentId, snapshotId, {
      evictLive: false,
    })
    if (!doc) return null

    const nextProject: Project = {
      ...project,
      title: doc.title,
      updatedAt: doc.updatedAt,
    }

    await dal.update(id, {
      title: doc.title,
      updatedAt: doc.updatedAt,
    })

    return docToProjectWithContent(doc, nextProject)
  })

  if (!restored || !restoredDocumentId) return restored

  evictLiveDocument(restoredDocumentId, {
    closeCode: YJS_RESTORE_CLOSE_CODE,
    closeReason: YJS_RESTORE_CLOSE_REASON,
  })

  return restored
}

export async function getProjectVersions(id: string): Promise<VersionSnapshot[]> {
  if (!isValidId(id)) return []

  const projectDoc = await dalProjectDocs.findDocumentByProjectId(id)
  if (!projectDoc) return []

  return docsRepo.getVersionHistory(projectDoc.documentId)
}

export async function hasProject(id: string): Promise<boolean> {
  if (!isValidId(id)) return false
  return (await dal.findById(id)) !== undefined
}

export async function createProjectSnapshot(id: string): Promise<VersionSnapshot | null> {
  if (!isValidId(id)) return null

  const projectDoc = await dalProjectDocs.findDocumentByProjectId(id)
  if (!projectDoc) return null

  return docsRepo.createVersionSnapshot(projectDoc.documentId)
}

export async function deleteProject(id: string): Promise<boolean> {
  if (!isValidId(id)) return false

  const existing = await dal.findById(id)
  if (!existing) return false

  await withTransaction(async () => {
    const projectDoc = await dalProjectDocs.findDocumentByProjectId(id)
    if (projectDoc) {
      await docsRepo.deleteDocument(projectDoc.documentId)
    }
    await dal.deleteById(id)
  })

  return true
}
