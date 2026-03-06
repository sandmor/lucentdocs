import type {
  AuthDataRepositoryPort,
  AuthInvitationEntity,
  AuthSessionEntity,
  AuthUserEntity,
  AuthUserRole,
} from '../../core/ports/authData.port.js'
import type { SqliteConnection } from './connection.js'

interface AuthUserRow {
  id: string
  name: string
  email: string
  passwordHash: string
  role: AuthUserRole
  createdAt: number
  updatedAt: number
  lastLoginAt: number | null
}

interface AuthInvitationRow {
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

interface AuthSessionRow {
  token: string
  userId: string
  createdAt: number
  expiresAt: number
}

function fromUserRow(row: AuthUserRow): AuthUserEntity {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
  }
}

function fromInvitationRow(row: AuthInvitationRow): AuthInvitationEntity {
  return {
    id: row.id,
    token: row.token,
    email: row.email,
    role: row.role,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    usedAt: row.usedAt,
    usedByUserId: row.usedByUserId,
  }
}

function fromSessionRow(row: AuthSessionRow): AuthSessionEntity {
  return {
    token: row.token,
    userId: row.userId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  }
}

export class AuthDataRepository implements AuthDataRepositoryPort {
  constructor(private connection: SqliteConnection) {}

  async countUsers(): Promise<number> {
    const row = this.connection.get<{ count: number }>(
      'SELECT COUNT(1) as count FROM auth_users',
      []
    )
    return row?.count ?? 0
  }

  async countAdminUsers(): Promise<number> {
    const row = this.connection.get<{ count: number }>(
      "SELECT COUNT(1) as count FROM auth_users WHERE role = 'admin'",
      []
    )
    return row?.count ?? 0
  }

  async listUsers(): Promise<AuthUserEntity[]> {
    const rows = this.connection.all<AuthUserRow>(
      'SELECT * FROM auth_users ORDER BY createdAt DESC',
      []
    )
    return rows.map(fromUserRow)
  }

  async findUserById(id: string): Promise<AuthUserEntity | undefined> {
    const row = this.connection.get<AuthUserRow>('SELECT * FROM auth_users WHERE id = ?', [id])
    return row ? fromUserRow(row) : undefined
  }

  async findUserByEmail(email: string): Promise<AuthUserEntity | undefined> {
    const row = this.connection.get<AuthUserRow>('SELECT * FROM auth_users WHERE email = ?', [
      email,
    ])
    return row ? fromUserRow(row) : undefined
  }

  async insertUser(user: AuthUserEntity): Promise<void> {
    this.connection.run(
      [
        'INSERT INTO auth_users (id, name, email, passwordHash, role, createdAt, updatedAt, lastLoginAt)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
      [
        user.id,
        user.name,
        user.email,
        user.passwordHash,
        user.role,
        user.createdAt,
        user.updatedAt,
        user.lastLoginAt,
      ]
    )
  }

  async updateUserRole(id: string, role: AuthUserRole, updatedAt: number): Promise<void> {
    this.connection.run('UPDATE auth_users SET role = ?, updatedAt = ? WHERE id = ?', [
      role,
      updatedAt,
      id,
    ])
  }

  async updateUserLastLogin(id: string, lastLoginAt: number, updatedAt: number): Promise<void> {
    this.connection.run('UPDATE auth_users SET lastLoginAt = ?, updatedAt = ? WHERE id = ?', [
      lastLoginAt,
      updatedAt,
      id,
    ])
  }

  async deleteUserById(id: string): Promise<void> {
    this.connection.run('DELETE FROM auth_users WHERE id = ?', [id])
  }

  async listInvitations(): Promise<AuthInvitationEntity[]> {
    const rows = this.connection.all<AuthInvitationRow>(
      'SELECT * FROM auth_invitations ORDER BY createdAt DESC',
      []
    )
    return rows.map(fromInvitationRow)
  }

  async findInvitationById(id: string): Promise<AuthInvitationEntity | undefined> {
    const row = this.connection.get<AuthInvitationRow>(
      'SELECT * FROM auth_invitations WHERE id = ?',
      [id]
    )
    return row ? fromInvitationRow(row) : undefined
  }

  async findInvitationByToken(token: string): Promise<AuthInvitationEntity | undefined> {
    const row = this.connection.get<AuthInvitationRow>(
      'SELECT * FROM auth_invitations WHERE token = ?',
      [token]
    )
    return row ? fromInvitationRow(row) : undefined
  }

  async insertInvitation(invitation: AuthInvitationEntity): Promise<void> {
    this.connection.run(
      [
        'INSERT INTO auth_invitations',
        '(id, token, email, role, createdByUserId, createdAt, expiresAt, revokedAt, usedAt, usedByUserId)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
      [
        invitation.id,
        invitation.token,
        invitation.email,
        invitation.role,
        invitation.createdByUserId,
        invitation.createdAt,
        invitation.expiresAt,
        invitation.revokedAt,
        invitation.usedAt,
        invitation.usedByUserId,
      ]
    )
  }

  async markInvitationUsed(id: string, usedByUserId: string, usedAt: number): Promise<void> {
    this.connection.run('UPDATE auth_invitations SET usedAt = ?, usedByUserId = ? WHERE id = ?', [
      usedAt,
      usedByUserId,
      id,
    ])
  }

  async revokeInvitation(id: string, revokedAt: number): Promise<void> {
    this.connection.run('UPDATE auth_invitations SET revokedAt = ? WHERE id = ?', [revokedAt, id])
  }

  async insertSession(session: AuthSessionEntity): Promise<void> {
    this.connection.run(
      'INSERT INTO auth_sessions (token, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
      [session.token, session.userId, session.createdAt, session.expiresAt]
    )
  }

  async findSessionByToken(token: string): Promise<AuthSessionEntity | undefined> {
    const row = this.connection.get<AuthSessionRow>('SELECT * FROM auth_sessions WHERE token = ?', [
      token,
    ])
    return row ? fromSessionRow(row) : undefined
  }

  async deleteSessionByToken(token: string): Promise<void> {
    this.connection.run('DELETE FROM auth_sessions WHERE token = ?', [token])
  }

  async deleteSessionsByUserId(userId: string): Promise<void> {
    this.connection.run('DELETE FROM auth_sessions WHERE userId = ?', [userId])
  }

  async deleteExpiredSessions(now: number): Promise<void> {
    this.connection.run('DELETE FROM auth_sessions WHERE expiresAt <= ?', [now])
  }
}
