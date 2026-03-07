import type { AuthPort } from '../../core/ports/auth.port.js'
import { LOCAL_DEFAULT_USER } from '../../core/models/user.js'

export class LocalAuthAdapter implements AuthPort {
  isEnabled(): boolean {
    return false
  }

  async getUserById(userId: string): Promise<typeof LOCAL_DEFAULT_USER | null> {
    return userId.trim() === LOCAL_DEFAULT_USER.id ? LOCAL_DEFAULT_USER : null
  }

  async getUserByEmail(email: string): Promise<null> {
    void email
    return null
  }

  async validateSession(token: string): Promise<typeof LOCAL_DEFAULT_USER> {
    void token
    return LOCAL_DEFAULT_USER
  }

  async login(email: string, password: string): Promise<{ success: false; error: string }> {
    void email
    void password
    return { success: false, error: 'Authentication is disabled.' }
  }

  async logout(token: string): Promise<{ success: true }> {
    void token
    return { success: true }
  }

  async signup(data: {
    name: string
    email: string
    password: string
    invitationToken: string
  }): Promise<{ success: false; error: string }> {
    void data
    return { success: false, error: 'Authentication is disabled.' }
  }
}
