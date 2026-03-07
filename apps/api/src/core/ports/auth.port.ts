import type { User } from '../models/user.js'

export interface AuthPort {
  isEnabled(): boolean
  getUserById(userId: string): Promise<User | null>
  getUserByEmail(email: string): Promise<User | null>
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
