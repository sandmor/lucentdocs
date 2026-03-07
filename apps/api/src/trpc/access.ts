import { TRPCError } from '@trpc/server'
import type { Project } from '@lucentdocs/shared'
import { canUserAccessProject } from '../core/models/project-access.js'
import type { AppContext } from './index.js'
import { projectSyncBus } from '../app/project-sync.js'

function createProjectNotFoundError(projectId: string): TRPCError {
  return new TRPCError({
    code: 'NOT_FOUND',
    message: `Project ${projectId} not found`,
  })
}

export async function assertProjectAccess(ctx: AppContext, projectId: string): Promise<Project> {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Not authenticated',
    })
  }

  const project = await ctx.services.projects.getById(projectId)
  if (!project || !canUserAccessProject(ctx.user, project)) {
    throw createProjectNotFoundError(projectId)
  }

  return project
}

export function canAccessProject(
  user: Pick<NonNullable<AppContext['user']>, 'id' | 'role'>,
  project: Pick<Project, 'ownerUserId'>
): boolean {
  return canUserAccessProject(user, project)
}

export function subscribeToProjectAccessRevocation(
  ctx: AppContext,
  projectId: string,
  onAccessRevoked: (error: TRPCError) => void
): () => void {
  if (!ctx.user) {
    return () => {}
  }

  return projectSyncBus.subscribe((event) => {
    if (event.projectId !== projectId) return
    if (event.type !== 'project.updated' && event.type !== 'project.deleted') return

    if (event.type === 'project.updated' && canUserAccessProject(ctx.user!, event)) {
      return
    }

    onAccessRevoked(createProjectNotFoundError(projectId))
  })
}
