import type { Request, Response, NextFunction } from 'express'

export function requireSafeFetch(req: Request, res: Response, next: NextFunction): void {
  // Allow OPTIONS requests to proceed before blocking
  if (req.method === 'OPTIONS') {
    next()
    return
  }

  const site = req.get('sec-fetch-site')

  // If the browser or client does not send Sec-Fetch-Site, allow it.
  // This ensures tools like curl, or older browsers can still access the API.
  if (!site) {
    next()
    return
  }

  // Strictly block cross-site requests to prevent CSRF and SSRF via browser
  if (site === 'cross-site') {
    res.status(403).json({ error: 'Forbidden: cross-site requests are not allowed' })
    return
  }

  // Allow same-origin, same-site, and none (direct navigation)
  next()
}
