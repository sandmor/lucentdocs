import type { Project, JsonObject } from '@lucentdocs/shared'

export interface UpdateProjectData {
  title?: string
  ownerUserId?: string
  metadata?: JsonObject | null
  updatedAt: number
}

export interface ProjectsRepositoryPort {
  findAll(): Promise<Project[]>
  findByOwnerUserId(ownerUserId: string): Promise<Project[]>
  findById(id: string): Promise<Project | undefined>
  findByIds(ids: string[]): Promise<Project[]>
  insert(project: Project): Promise<void>
  update(id: string, data: UpdateProjectData): Promise<void>
  deleteById(id: string): Promise<void>
}
