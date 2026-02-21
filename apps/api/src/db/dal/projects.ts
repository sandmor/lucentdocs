import { getDb } from '../client.js'

export interface ProjectRow {
    id: string
    title: string
    content: string
    createdAt: number
    updatedAt: number
}

export async function insert(project: ProjectRow): Promise<void> {
    const db = await getDb()
    await db.run(
        `INSERT INTO projects (id, title, content, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?)`,
        [
            project.id,
            project.title,
            project.content,
            project.createdAt,
            project.updatedAt,
        ]
    )
}

export async function findAll(): Promise<ProjectRow[]> {
    const db = await getDb()
    return db.all<ProjectRow[]>(
        `SELECT * FROM projects ORDER BY updatedAt DESC`
    )
}

export async function findById(id: string): Promise<ProjectRow | undefined> {
    const db = await getDb()
    return db.get<ProjectRow>(
        `SELECT * FROM projects WHERE id = ?`,
        [id]
    )
}

export async function update(
    id: string,
    data: Pick<ProjectRow, 'title' | 'content' | 'updatedAt'>
): Promise<void> {
    const db = await getDb()
    await db.run(
        `UPDATE projects
     SET title = ?, content = ?, updatedAt = ?
     WHERE id = ?`,
        [data.title, data.content, data.updatedAt, id]
    )
}

export async function deleteById(id: string): Promise<void> {
    const db = await getDb()
    await db.run(`DELETE FROM projects WHERE id = ?`, [id])
}
