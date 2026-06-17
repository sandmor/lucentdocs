import type { Project } from '@lucentdocs/shared'
import type { NativeStorageEngine } from '@lucentdocs/core'
import type { ProjectsRepositoryPort, UpdateProjectData } from '../../core/ports/projects.port.js'
import { currentTxId } from './tx-scope.js'
import { projectFromDto, projectToDto, updateProjectToDto } from './mappers.js'

export class ProjectsRepository implements ProjectsRepositoryPort {
  constructor(private engine: NativeStorageEngine) {}

  async findAll(): Promise<Project[]> {
    const rows = await this.engine.projectsFindAll(currentTxId())
    return rows.map(projectFromDto)
  }

  async findByOwnerUserId(ownerUserId: string): Promise<Project[]> {
    const rows = await this.engine.projectsFindByOwnerUserId(currentTxId(), ownerUserId)
    return rows.map(projectFromDto)
  }

  async findById(id: string): Promise<Project | undefined> {
    const row = await this.engine.projectsFindById(currentTxId(), id)
    return row ? projectFromDto(row) : undefined
  }

  async findByIds(ids: string[]): Promise<Project[]> {
    const rows = await this.engine.projectsFindByIds(currentTxId(), ids)
    return rows.map(projectFromDto)
  }

  async insert(project: Project): Promise<void> {
    await this.engine.projectsInsert(currentTxId(), projectToDto(project))
  }

  async update(id: string, data: UpdateProjectData): Promise<void> {
    await this.engine.projectsUpdate(currentTxId(), id, updateProjectToDto(id, data))
  }

  async deleteById(id: string): Promise<void> {
    await this.engine.projectsDeleteById(currentTxId(), id)
  }
}
