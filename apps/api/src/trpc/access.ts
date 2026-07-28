import { TRPCError } from '@trpc/server'
import type { Project } from '@lucentdocs/shared'
import { canUserAccessProject } from '../core/models/project-access.js'
import type { AppContext } from './index.js'
import { projectSyncBus } from '../app/project-sync.js'
import type { DocumentAccessRole } from '@lucentdocs/shared'

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

export async function getDocumentAccessRole(
  ctx: AppContext,
  documentId: string
): Promise<'owner' | DocumentAccessRole | null> {
  if (!ctx.user) return null
  return ctx.services.documentSharing.getEffectiveRole(documentId, ctx.user.id)
}

export async function assertDocumentAccess(
  ctx: AppContext,
  documentId: string,
  required: 'viewer' | 'editor' = 'viewer'
): Promise<'owner' | DocumentAccessRole> {
  const role = await getDocumentAccessRole(ctx, documentId)
  if (!role || (required === 'editor' && role === 'viewer')) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `Document ${documentId} not found` })
  }
  return role
}

/**
 * The project mount is part of a document capability.  Checking a project and
 * a document independently is not enough: a collaborator must only be able to
 * use the document from projects where it is actually mounted.
 */
export async function assertMountedDocumentAccess(
  ctx: AppContext,
  input: { projectId: string; documentId: string },
  required: 'viewer' | 'editor' = 'viewer'
): Promise<'owner' | DocumentAccessRole> {
  await assertProjectAccess(ctx, input.projectId)
  const role = await assertDocumentAccess(ctx, input.documentId, required)
  const mounted = await ctx.services.documents.hasProjectAssociation(
    input.projectId,
    input.documentId
  )
  if (!mounted) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Document ${input.documentId} not found in project ${input.projectId}`,
    })
  }
  return role
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
