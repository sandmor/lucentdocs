import type { Project } from '@lucentdocs/shared'
import type { User } from './user.js'

export function canUserAccessProject(
  user: Pick<User, 'id' | 'role'>,
  project: Pick<Project, 'ownerUserId'>
): boolean {
  // Projects are deliberately private. An administrator can manage ownership
  // through the explicit admin procedures, but is not a silent member of every
  // project (nor, consequently, a silent owner of every document in one).
  return project.ownerUserId === user.id
}
