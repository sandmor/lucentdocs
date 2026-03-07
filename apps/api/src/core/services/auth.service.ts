import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { nanoid } from 'nanoid'
import type { RepositorySet } from '../ports/types.js'
import type { TransactionPort } from '../ports/transaction.port.js'
import type { AuthInvitationEntity, AuthUserEntity, AuthUserRole } from '../ports/authData.port.js'
import type { User } from '../models/user.js'

const PASSWORD_HASH_KEYLEN = 64
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface AuthInvitationSummary {
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

export interface AuthUserSummary {
  id: string
  name: string
  email: string
  role: AuthUserRole
  createdAt: number
  updatedAt: number
  lastLoginAt: number | null
}

export interface AuthService {
  ensureDefaultAdminUser(options?: { env?: NodeJS.ProcessEnv }): Promise<AuthUserSummary | null>
  listUsers(): Promise<AuthUserSummary[]>
  deleteUser(userId: string, actingUserId: string): Promise<void>
  listInvitations(): Promise<AuthInvitationSummary[]>
  createInvitation(input: {
    email: string | null
    role: AuthUserRole
    expiresAt: number
    createdByUserId: string
  }): Promise<AuthInvitationSummary>
  revokeInvitation(id: string): Promise<void>
  getValidInvitationByToken(token: string): Promise<AuthInvitationSummary | null>
  loginWithPassword(email: string, password: string): Promise<AuthUserSummary | null>
  signupWithInvitation(input: {
    name: string
    email: string
    password: string
    invitationToken: string
  }): Promise<AuthUserSummary>
  createSession(userId: string): Promise<{ token: string; expiresAt: number }>
  logoutSession(token: string): Promise<void>
  getUserById(userId: string): Promise<User | null>
  getUserByEmail(email: string): Promise<User | null>
  getUserBySessionToken(token: string): Promise<User | null>
}

function trimEmail(email: string): string {
  return email.trim().toLowerCase()
}

function readTrimmedEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key]
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed ? trimmed : undefined
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, PASSWORD_HASH_KEYLEN).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expectedHash] = storedHash.split(':')
  if (!salt || !expectedHash) return false
  const computed = scryptSync(password, salt, PASSWORD_HASH_KEYLEN).toString('hex')
  const expectedBuf = Buffer.from(expectedHash, 'hex')
  const computedBuf = Buffer.from(computed, 'hex')
  if (expectedBuf.length !== computedBuf.length) return false
  return timingSafeEqual(expectedBuf, computedBuf)
}

function toUserSummary(entity: AuthUserEntity): AuthUserSummary {
  return {
    id: entity.id,
    name: entity.name,
    email: entity.email,
    role: entity.role,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    lastLoginAt: entity.lastLoginAt,
  }
}

function toInvitationSummary(entity: AuthInvitationEntity): AuthInvitationSummary {
  return {
    id: entity.id,
    token: entity.token,
    email: entity.email,
    role: entity.role,
    createdByUserId: entity.createdByUserId,
    createdAt: entity.createdAt,
    expiresAt: entity.expiresAt,
    revokedAt: entity.revokedAt,
    usedAt: entity.usedAt,
    usedByUserId: entity.usedByUserId,
  }
}

function toRuntimeUser(entity: AuthUserEntity): User {
  return {
    id: entity.id,
    name: entity.name,
    email: entity.email,
    role: entity.role,
  }
}

function isInvitationValid(invitation: AuthInvitationEntity, now: number): boolean {
  if (invitation.revokedAt !== null) return false
  if (invitation.usedAt !== null) return false
  return invitation.expiresAt > now
}

export function createAuthService(repos: RepositorySet, transaction: TransactionPort): AuthService {
  return {
    async ensureDefaultAdminUser(options?: {
      env?: NodeJS.ProcessEnv
    }): Promise<AuthUserSummary | null> {
      const env = options?.env ?? process.env

      return transaction.run(async () => {
        const adminCount = await repos.authData.countAdminUsers()
        if (adminCount > 0) return null

        const now = Date.now()
        const defaultEmail = trimEmail(
          readTrimmedEnvValue(env, 'AUTH_BOOTSTRAP_ADMIN_EMAIL') ?? 'admin@lucentdocs.local'
        )
        const defaultName = readTrimmedEnvValue(env, 'AUTH_BOOTSTRAP_ADMIN_NAME') ?? 'Admin'
        const defaultPassword =
          readTrimmedEnvValue(env, 'AUTH_BOOTSTRAP_ADMIN_PASSWORD') ?? 'admin12345'

        if (defaultPassword.length < 8) {
          throw new Error('AUTH_BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters.')
        }

        const existing = await repos.authData.findUserByEmail(defaultEmail)
        if (existing) {
          if (existing.role !== 'admin') {
            await repos.authData.updateUserRole(existing.id, 'admin', now)
          }

          const refreshed = await repos.authData.findUserById(existing.id)
          if (!refreshed) {
            throw new Error('Failed to load bootstrapped admin user.')
          }
          return toUserSummary(refreshed)
        }

        const user: AuthUserEntity = {
          id: nanoid(),
          name: defaultName,
          email: defaultEmail,
          passwordHash: hashPassword(defaultPassword),
          role: 'admin',
          createdAt: now,
          updatedAt: now,
          lastLoginAt: null,
        }

        await repos.authData.insertUser(user)
        return toUserSummary(user)
      })
    },

    async listUsers(): Promise<AuthUserSummary[]> {
      const users = await repos.authData.listUsers()
      return users.map(toUserSummary)
    },

    async deleteUser(userId: string, actingUserId: string): Promise<void> {
      if (userId === actingUserId) {
        throw new Error('You cannot delete your own account.')
      }

      await transaction.run(async () => {
        const existing = await repos.authData.findUserById(userId)
        if (!existing) {
          throw new Error('User not found.')
        }

        await repos.authData.deleteSessionsByUserId(userId)
        await repos.authData.deleteUserById(userId)
      })
    },

    async listInvitations(): Promise<AuthInvitationSummary[]> {
      const invitations = await repos.authData.listInvitations()
      return invitations.map(toInvitationSummary)
    },

    async createInvitation(input): Promise<AuthInvitationSummary> {
      const now = Date.now()
      if (input.expiresAt <= now) {
        throw new Error('Invitation expiration must be in the future.')
      }

      const invitation: AuthInvitationEntity = {
        id: nanoid(),
        token: randomBytes(24).toString('base64url'),
        email: input.email,
        role: input.role,
        createdByUserId: input.createdByUserId,
        createdAt: now,
        expiresAt: input.expiresAt,
        revokedAt: null,
        usedAt: null,
        usedByUserId: null,
      }

      await repos.authData.insertInvitation(invitation)
      return toInvitationSummary(invitation)
    },

    async revokeInvitation(id: string): Promise<void> {
      const invitation = await repos.authData.findInvitationById(id)
      if (!invitation) {
        throw new Error('Invitation not found.')
      }
      if (invitation.usedAt !== null) {
        throw new Error('Used invitations cannot be revoked.')
      }

      await repos.authData.revokeInvitation(id, Date.now())
    },

    async getValidInvitationByToken(token: string): Promise<AuthInvitationSummary | null> {
      const trimmedToken = token.trim()
      if (!trimmedToken) return null
      const invitation = await repos.authData.findInvitationByToken(trimmedToken)
      if (!invitation) return null
      if (!isInvitationValid(invitation, Date.now())) return null
      return toInvitationSummary(invitation)
    },

    async loginWithPassword(email: string, password: string): Promise<AuthUserSummary | null> {
      const normalizedEmail = trimEmail(email)
      const user = await repos.authData.findUserByEmail(normalizedEmail)
      if (!user) return null
      if (!verifyPassword(password, user.passwordHash)) return null

      const now = Date.now()
      await repos.authData.updateUserLastLogin(user.id, now, now)
      const refreshed = await repos.authData.findUserById(user.id)
      if (!refreshed) return null

      return toUserSummary(refreshed)
    },

    async signupWithInvitation(input): Promise<AuthUserSummary> {
      const normalizedEmail = trimEmail(input.email)
      const trimmedName = input.name.trim()
      const trimmedToken = input.invitationToken.trim()

      if (!trimmedName) throw new Error('Name is required.')
      if (!trimmedToken) throw new Error('Invitation token is required.')

      return transaction.run(async () => {
        const now = Date.now()
        await repos.authData.deleteExpiredSessions(now)

        const invitation = await repos.authData.findInvitationByToken(trimmedToken)
        if (!invitation || !isInvitationValid(invitation, now)) {
          throw new Error('Invitation is invalid or expired.')
        }

        if (invitation.email && trimEmail(invitation.email) !== normalizedEmail) {
          throw new Error('This invitation is restricted to a different email address.')
        }

        const existing = await repos.authData.findUserByEmail(normalizedEmail)
        if (existing) {
          throw new Error('An account with this email already exists.')
        }

        const user: AuthUserEntity = {
          id: nanoid(),
          name: trimmedName,
          email: normalizedEmail,
          passwordHash: hashPassword(input.password),
          role: invitation.role,
          createdAt: now,
          updatedAt: now,
          lastLoginAt: now,
        }

        await repos.authData.insertUser(user)
        await repos.authData.markInvitationUsed(invitation.id, user.id, now)

        return toUserSummary(user)
      })
    },

    async createSession(userId: string): Promise<{ token: string; expiresAt: number }> {
      const now = Date.now()
      const session = {
        token: randomBytes(24).toString('base64url'),
        userId,
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS,
      }

      await repos.authData.insertSession(session)
      return { token: session.token, expiresAt: session.expiresAt }
    },

    async logoutSession(token: string): Promise<void> {
      const trimmed = token.trim()
      if (!trimmed) return
      await repos.authData.deleteSessionByToken(trimmed)
    },

    async getUserById(userId: string): Promise<User | null> {
      const trimmedUserId = userId.trim()
      if (!trimmedUserId) return null

      const user = await repos.authData.findUserById(trimmedUserId)
      return user ? toRuntimeUser(user) : null
    },

    async getUserByEmail(email: string): Promise<User | null> {
      const normalizedEmail = trimEmail(email)
      if (!normalizedEmail) return null

      const user = await repos.authData.findUserByEmail(normalizedEmail)
      return user ? toRuntimeUser(user) : null
    },

    async getUserBySessionToken(token: string): Promise<User | null> {
      const trimmed = token.trim()
      if (!trimmed) return null

      const now = Date.now()
      const session = await repos.authData.findSessionByToken(trimmed)
      if (!session) return null
      if (session.expiresAt <= now) {
        await repos.authData.deleteSessionByToken(trimmed)
        return null
      }

      const user = await repos.authData.findUserById(session.userId)
      if (!user) {
        await repos.authData.deleteSessionByToken(trimmed)
        return null
      }

      return toRuntimeUser(user)
    },
  }
}
