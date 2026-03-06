import type { User } from '../models/user.js'

export interface AuthPort {
  isEnabled(): boolean
  validateSession(token: string): Promise<User | null>
  login(
    email: string,
    password: string
  ): Promise<
    | { success: true; token: string; expiresAt: number; user: User }
    | { success: false; error: string }
  >
  logout(token: string): Promise<{ success: boolean; error?: string }>
  signup(data: {
    name: string
    email: string
    password: string
    invitationToken: string
  }): Promise<
    | { success: true; token: string; expiresAt: number; user: User }
    | { success: false; error: string }
  >
}
