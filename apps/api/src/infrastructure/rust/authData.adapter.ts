import type { NativeStorageEngine } from '@lucentdocs/core'
import type {
  AuthDataRepositoryPort,
  AuthInvitationEntity,
  AuthSessionEntity,
  AuthUserEntity,
  AuthUserRole,
} from '../../core/ports/authData.port.js'
import { currentTxId } from './tx-scope.js'
import {
  authInvitationFromDto,
  authInvitationToDto,
  authSessionFromDto,
  authSessionToDto,
  authUserFromDto,
  authUserToDto,
} from './mappers.js'

export class AuthDataRepository implements AuthDataRepositoryPort {
  constructor(private engine: NativeStorageEngine) {}

  async countUsers(): Promise<number> {
    return this.engine.authDataCountUsers(currentTxId())
  }

  async countAdminUsers(): Promise<number> {
    return this.engine.authDataCountAdminUsers(currentTxId())
  }

  async listUsers(): Promise<AuthUserEntity[]> {
    const rows = await this.engine.authDataListUsers(currentTxId())
    return rows.map(authUserFromDto)
  }

  async findUserById(id: string): Promise<AuthUserEntity | undefined> {
    const row = await this.engine.authDataFindUserById(currentTxId(), id)
    return row ? authUserFromDto(row) : undefined
  }

  async findUserByEmail(email: string): Promise<AuthUserEntity | undefined> {
    const row = await this.engine.authDataFindUserByEmail(currentTxId(), email)
    return row ? authUserFromDto(row) : undefined
  }

  async insertUser(user: AuthUserEntity): Promise<void> {
    await this.engine.authDataInsertUser(currentTxId(), authUserToDto(user))
  }

  async updateUserRole(id: string, role: AuthUserRole, updatedAt: number): Promise<void> {
    await this.engine.authDataUpdateUserRole(currentTxId(), id, role, updatedAt)
  }

  async updateUserLastLogin(id: string, lastLoginAt: number, updatedAt: number): Promise<void> {
    await this.engine.authDataUpdateUserLastLogin(currentTxId(), id, lastLoginAt, updatedAt)
  }

  async deleteUserById(id: string): Promise<void> {
    await this.engine.authDataDeleteUserById(currentTxId(), id)
  }

  async listInvitations(): Promise<AuthInvitationEntity[]> {
    const rows = await this.engine.authDataListInvitations(currentTxId())
    return rows.map(authInvitationFromDto)
  }

  async findInvitationById(id: string): Promise<AuthInvitationEntity | undefined> {
    const row = await this.engine.authDataFindInvitationById(currentTxId(), id)
    return row ? authInvitationFromDto(row) : undefined
  }

  async findInvitationByToken(token: string): Promise<AuthInvitationEntity | undefined> {
    const row = await this.engine.authDataFindInvitationByToken(currentTxId(), token)
    return row ? authInvitationFromDto(row) : undefined
  }

  async insertInvitation(invitation: AuthInvitationEntity): Promise<void> {
    await this.engine.authDataInsertInvitation(currentTxId(), authInvitationToDto(invitation))
  }

  async markInvitationUsed(id: string, usedByUserId: string, usedAt: number): Promise<void> {
    await this.engine.authDataMarkInvitationUsed(currentTxId(), id, usedByUserId, usedAt)
  }

  async revokeInvitation(id: string, revokedAt: number): Promise<void> {
    await this.engine.authDataRevokeInvitation(currentTxId(), id, revokedAt)
  }

  async insertSession(session: AuthSessionEntity): Promise<void> {
    await this.engine.authDataInsertSession(currentTxId(), authSessionToDto(session))
  }

  async findSessionByToken(token: string): Promise<AuthSessionEntity | undefined> {
    const row = await this.engine.authDataFindSessionByToken(currentTxId(), token)
    return row ? authSessionFromDto(row) : undefined
  }

  async deleteSessionByToken(token: string): Promise<void> {
    await this.engine.authDataDeleteSessionByToken(currentTxId(), token)
  }

  async deleteSessionsByUserId(userId: string): Promise<void> {
    await this.engine.authDataDeleteSessionsByUserId(currentTxId(), userId)
  }

  async deleteExpiredSessions(now: number): Promise<void> {
    await this.engine.authDataDeleteExpiredSessions(currentTxId(), now)
  }
}
