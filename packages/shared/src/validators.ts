import { z } from 'zod'

const ID_REGEX = /^[A-Za-z0-9_-]+$/

export function isValidId(id: string): boolean {
  return ID_REGEX.test(id)
}

/**
 * Minimum password requirements shared between frontend and backend.
 * Any change here affects both signup validation and the UI strength bar.
 */
export const authPasswordSchema = z.string().min(8, 'Password must be at least 8 characters')
