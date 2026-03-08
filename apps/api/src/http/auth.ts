import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { AuthPort } from '../core/ports/auth.port.js'
import type { User } from '../core/models/user.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User | null
    }
  }
}

const AUTH_COOKIE_NAME = 'lucentdocs_auth'

function safeDecodeCookieComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {}

  const parsed: Record<string, string> = {}
  for (const entry of cookieHeader.split(';')) {
    const trimmed = entry.trim()
    if (!trimmed) continue

    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue

    const key = safeDecodeCookieComponent(trimmed.slice(0, separator).trim())
    const value = safeDecodeCookieComponent(trimmed.slice(separator + 1).trim())
    parsed[key] = value
  }

  return parsed
}

function readCookieValue(cookies: Record<string, string>, key: string): string | null {
  const value = cookies[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isSecureRequest(req: Request): boolean {
  if (req.secure) return true
  const forwardedProto = req.get('x-forwarded-proto')
  if (!forwardedProto) return false
  return forwardedProto
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .includes('https')
}

export function readSessionTokenFromCookieHeader(cookieHeader: string | undefined): string | null {
  return readCookieValue(parseCookieHeader(cookieHeader), AUTH_COOKIE_NAME)
}

export function readSessionToken(req: Request): string | null {
  // Prefer parsed cookies from cookie-parser, but fall back to the raw header so
  // partially initialized requests still resolve auth consistently.
  const fromParsedCookies = readCookieValue(req.cookies as Record<string, string>, AUTH_COOKIE_NAME)
  if (fromParsedCookies) return fromParsedCookies
  return readSessionTokenFromCookieHeader(req.headers.cookie)
}

export function setSessionCookie(req: Request, token: string, expiresAt: number): void {
  req.res?.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    expires: new Date(expiresAt),
    path: '/',
  })
}

export function clearSessionCookie(req: Request): void {
  req.res?.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/',
  })
}

export function injectUserMiddleware(authPort: AuthPort): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!authPort.isEnabled()) {
        req.user = await authPort.validateSession('')
        next()
        return
      }

      const token = readSessionToken(req)
      req.user = token ? await authPort.validateSession(token) : null
      next()
    } catch (error) {
      console.error('Failed to resolve user session:', error)
      req.user = null
      next()
    }
  }
}
