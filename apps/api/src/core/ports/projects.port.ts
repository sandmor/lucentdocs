import type { Project, JsonObject } from '@plotline/shared'

export interface UpdateProjectData {
  title?: string
  metadata?: JsonObject | null
  updatedAt: number
}

export interface ProjectsRepositoryPort {
  findAll(): Promise<Project[]>
  findById(id: string): Promise<Project | undefined>
  insert(project: Project): Promise<void>
  update(id: string, data: UpdateProjectData): Promise<void>
  deleteById(id: string): Promise<void>
}
