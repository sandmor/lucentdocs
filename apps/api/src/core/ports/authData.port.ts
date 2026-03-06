export type AuthUserRole = 'admin' | 'user'

export interface AuthUserEntity {
  id: string
  name: string
  email: string
  passwordHash: string
  role: AuthUserRole
  createdAt: number
  updatedAt: number
  lastLoginAt: number | null
}

export interface AuthInvitationEntity {
  id: string
  token: string
  email: string | null
  role: AuthUserRole
  createdByUserId: string
  createdAt: number
  expiresAt: number
  revokedAt: number | null
  usedAt: number | null
  usedByUserId: string | null
}

export interface AuthSessionEntity {
  token: string
  userId: string
  createdAt: number
  expiresAt: number
}

export interface AuthDataRepositoryPort {
  countUsers(): Promise<number>
  countAdminUsers(): Promise<number>
  listUsers(): Promise<AuthUserEntity[]>
  findUserById(id: string): Promise<AuthUserEntity | undefined>
  findUserByEmail(email: string): Promise<AuthUserEntity | undefined>
  insertUser(user: AuthUserEntity): Promise<void>
  updateUserRole(id: string, role: AuthUserRole, updatedAt: number): Promise<void>
  updateUserLastLogin(id: string, lastLoginAt: number, updatedAt: number): Promise<void>
  deleteUserById(id: string): Promise<void>

  listInvitations(): Promise<AuthInvitationEntity[]>
  findInvitationById(id: string): Promise<AuthInvitationEntity | undefined>
  findInvitationByToken(token: string): Promise<AuthInvitationEntity | undefined>
  insertInvitation(invitation: AuthInvitationEntity): Promise<void>
  markInvitationUsed(id: string, usedByUserId: string, usedAt: number): Promise<void>
  revokeInvitation(id: string, revokedAt: number): Promise<void>

  insertSession(session: AuthSessionEntity): Promise<void>
  findSessionByToken(token: string): Promise<AuthSessionEntity | undefined>
  deleteSessionByToken(token: string): Promise<void>
  deleteSessionsByUserId(userId: string): Promise<void>
  deleteExpiredSessions(now: number): Promise<void>
}
