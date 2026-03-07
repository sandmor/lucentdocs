import type { AuthPort } from '../../core/ports/auth.port.js'
import type { User } from '../../core/models/user.js'
import type { AuthService } from '../../core/services/auth.service.js'

export class SqliteAuthAdapter implements AuthPort {
  constructor(private readonly authService: AuthService) {}

  isEnabled(): boolean {
    return true
  }

  async getUserById(userId: string): Promise<User | null> {
    return this.authService.getUserById(userId)
  }

  async getUserByEmail(email: string): Promise<User | null> {
    return this.authService.getUserByEmail(email)
  }

  async validateSession(token: string): Promise<User | null> {
    return this.authService.getUserBySessionToken(token)
  }

  async login(
    email: string,
    password: string
  ): Promise<
    | { success: true; token: string; expiresAt: number; user: User }
    | { success: false; error: string }
  > {
    const userSummary = await this.authService.loginWithPassword(email, password)
    if (!userSummary) {
      return { success: false, error: 'Invalid email or password.' }
    }

    const session = await this.authService.createSession(userSummary.id)
    const user: User = {
      id: userSummary.id,
      name: userSummary.name,
      email: userSummary.email,
      role: userSummary.role,
    }
    return { success: true, token: session.token, expiresAt: session.expiresAt, user }
  }

  async logout(token: string): Promise<{ success: boolean; error?: string }> {
    await this.authService.logoutSession(token)
    return { success: true }
  }

  async signup(data: {
    name: string
    email: string
    password: string
    invitationToken: string
  }): Promise<
    | { success: true; token: string; expiresAt: number; user: User }
    | { success: false; error: string }
  > {
    try {
      const userSummary = await this.authService.signupWithInvitation(data)
      const session = await this.authService.createSession(userSummary.id)
      const user: User = {
        id: userSummary.id,
        name: userSummary.name,
        email: userSummary.email,
        role: userSummary.role,
      }
      return { success: true, token: session.token, expiresAt: session.expiresAt, user }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sign up.',
      }
    }
  }
}
