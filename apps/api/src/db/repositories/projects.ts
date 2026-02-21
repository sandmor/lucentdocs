import { nanoid } from 'nanoid'
import { isValidId, type Project } from '@plotline/shared'
import * as dal from '../dal/projects.js'

export async function createProject(title: string): Promise<Project> {
  const now = Date.now()
  const project: Project = {
    id: nanoid(),
    title,
    content: JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    }),
    createdAt: now,
    updatedAt: now,
  }

  await dal.insert(project)
  return project
}

export async function listProjects(): Promise<Project[]> {
  const rows = await dal.findAll()
  // Since dal returns ProjectRow which matches Project right now,
  // we just return the rows.
  return rows
}

export async function getProject(id: string): Promise<Project | null> {
  if (!isValidId(id)) return null
  const row = await dal.findById(id)
  return row || null
}

export async function updateProject(
  id: string,
  data: Partial<Pick<Project, 'title' | 'content'>>
): Promise<Project | null> {
  if (!isValidId(id)) return null
  const existing = await getProject(id)
  if (!existing) return null

  const updated: Project = {
    ...existing,
    ...data,
    updatedAt: Date.now(),
  }

  await dal.update(id, {
    title: updated.title,
    content: updated.content,
    updatedAt: updated.updatedAt,
  })

  return updated
}

export async function deleteProject(id: string): Promise<boolean> {
  if (!isValidId(id)) return false
  const existing = await dal.findById(id)
  if (!existing) return false
  await dal.deleteById(id)
  return true
}
