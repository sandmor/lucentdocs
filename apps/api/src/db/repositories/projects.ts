import type { Table } from '@lancedb/lancedb'
import { getDb } from '../client.js'
import { nanoid } from 'nanoid'
import { isValidId, type Project } from '@plotline/shared'

const TABLE_NAME = 'projects'
let tablePromise: Promise<Table> | null = null

function mapRowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    title: row.title as string,
    content: row.content as string,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
  }
}

function escapeSqlLiteral(value: string): string {
  return value.replaceAll("'", "''")
}

function byIdFilter(id: string): string {
  return `id = '${escapeSqlLiteral(id)}'`
}

async function initializeTable(): Promise<Table> {
  const db = await getDb()
  const tableNames = await db.tableNames()

  if (tableNames.includes(TABLE_NAME)) {
    try {
      return await db.openTable(TABLE_NAME)
    } catch {
      // Table exists but data is corrupted/missing - fall through to recreate
    }
  }

  const sentinel: Record<string, unknown> = {
    id: '__init__',
    title: '',
    content: '',
    createdAt: 0,
    updatedAt: 0,
  }

  try {
    const table = await db.createTable(TABLE_NAME, [sentinel])
    await table.delete(byIdFilter('__init__'))
    return table
  } catch {
    return db.openTable(TABLE_NAME)
  }
}

async function getTable(): Promise<Table> {
  if (!tablePromise) {
    tablePromise = initializeTable()
  }

  return tablePromise
}

export async function createProject(title: string): Promise<Project> {
  const table = await getTable()
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
  await table.add([
    {
      id: project.id,
      title: project.title,
      content: project.content,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
  ])
  return project
}

export async function listProjects(): Promise<Project[]> {
  const table = await getTable()
  const rows = await table.query().toArray()
  return rows
    .map((row) => mapRowToProject(row as Record<string, unknown>))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getProject(id: string): Promise<Project | null> {
  if (!isValidId(id)) return null
  const table = await getTable()
  const rows = await table.query().where(byIdFilter(id)).toArray()
  if (rows.length === 0) return null
  return mapRowToProject(rows[0] as Record<string, unknown>)
}

export async function updateProject(
  id: string,
  data: Partial<Pick<Project, 'title' | 'content'>>
): Promise<Project | null> {
  if (!isValidId(id)) return null
  const table = await getTable()
  const existing = await getProject(id)
  if (!existing) return null

  const updated: Project = {
    ...existing,
    ...data,
    updatedAt: Date.now(),
  }

  await table.update({
    where: byIdFilter(id),
    values: {
      title: updated.title,
      content: updated.content,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    },
  })
  return updated
}

export async function deleteProject(id: string): Promise<boolean> {
  if (!isValidId(id)) return false
  const table = await getTable()
  const existing = await getProject(id)
  if (!existing) return false
  await table.delete(byIdFilter(id))
  return true
}
