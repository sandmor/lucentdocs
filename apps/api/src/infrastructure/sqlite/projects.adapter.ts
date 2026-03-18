import type { Project } from '@lucentdocs/shared'
import type { ProjectsRepositoryPort, UpdateProjectData } from '../../core/ports/projects.port.js'
import type { SqliteConnection } from './connection.js'
import { toJsonField, fromJsonField, toOptionalJsonField } from './utils.js'

interface ProjectRow {
  id: string
  title: string
  ownerUserId: string
  metadata: string | null
  createdAt: number
  updatedAt: number
}

function toRow(project: Project): ProjectRow {
  return {
    id: project.id,
    title: project.title,
    ownerUserId: project.ownerUserId,
    metadata: toJsonField(project.metadata),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
}

function fromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    title: row.title,
    ownerUserId: row.ownerUserId,
    metadata: fromJsonField(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export class ProjectsRepository implements ProjectsRepositoryPort {
  constructor(private connection: SqliteConnection) {}

  async findAll(): Promise<Project[]> {
    const rows = this.connection.all<ProjectRow>(
      'SELECT * FROM projects ORDER BY updatedAt DESC',
      []
    )
    return rows.map(fromRow)
  }

  async findByOwnerUserId(ownerUserId: string): Promise<Project[]> {
    const rows = this.connection.all<ProjectRow>(
      'SELECT * FROM projects WHERE ownerUserId = ? ORDER BY updatedAt DESC',
      [ownerUserId]
    )
    return rows.map(fromRow)
  }

  async findById(id: string): Promise<Project | undefined> {
    const row = this.connection.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', [id])
    return row ? fromRow(row) : undefined
  }

  async findByIds(ids: string[]): Promise<Project[]> {
    const uniqueIds = Array.from(new Set(ids.filter((id) => id.length > 0)))
    if (uniqueIds.length === 0) {
      return []
    }

    const rows = this.connection.all<ProjectRow>(
      `WITH requested AS (
         SELECT value AS id
           FROM json_each(?)
       )
       SELECT p.*
         FROM projects AS p
         JOIN requested ON requested.id = p.id`,
      [JSON.stringify(uniqueIds)]
    )
    return rows.map(fromRow)
  }

  async insert(project: Project): Promise<void> {
    const row = toRow(project)
    this.connection.run(
      `INSERT INTO projects
        (id, title, ownerUserId, metadata, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, row.title, row.ownerUserId, row.metadata, row.createdAt, row.updatedAt]
    )
  }

  async update(id: string, data: UpdateProjectData): Promise<void> {
    const metadataStr = toOptionalJsonField(data.metadata)
    const hasTitle = data.title !== undefined ? 1 : 0
    const hasOwnerUserId = data.ownerUserId !== undefined ? 1 : 0
    const hasMetadata = data.metadata !== undefined ? 1 : 0

    this.connection.run(
      `UPDATE projects
       SET title = CASE WHEN ? = 1 THEN ? ELSE title END,
           ownerUserId = CASE WHEN ? = 1 THEN ? ELSE ownerUserId END,
           metadata = CASE WHEN ? = 1 THEN ? ELSE metadata END,
           updatedAt = ?
       WHERE id = ?`,
      [
        hasTitle,
        data.title ?? null,
        hasOwnerUserId,
        data.ownerUserId ?? '',
        hasMetadata,
        metadataStr ?? null,
        data.updatedAt,
        id,
      ]
    )
  }

  async deleteById(id: string): Promise<void> {
    this.connection.run('DELETE FROM projects WHERE id = ?', [id])
  }
}
