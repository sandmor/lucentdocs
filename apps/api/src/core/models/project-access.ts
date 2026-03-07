import type { Project } from '@lucentdocs/shared'
import type { User } from './user.js'

export function canUserAccessProject(
  user: Pick<User, 'id' | 'role'>,
  project: Pick<Project, 'ownerUserId'>
): boolean {
  return user.role === 'admin' || project.ownerUserId === user.id
}
