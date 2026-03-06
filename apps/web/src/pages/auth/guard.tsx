import { useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router'
import { trpc } from '@/lib/trpc'

export function AuthGuard() {
  const navigate = useNavigate()
  const configQuery = trpc.config.get.useQuery()
  const authEnabled = Boolean(configQuery.data?.fields.authEnabled.effectiveValue)
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    enabled: authEnabled,
  })

  useEffect(() => {
    if (configQuery.isLoading) return
    if (!authEnabled) return
    if (meQuery.isLoading) return
    if (meQuery.data) return

    navigate('/login', { replace: true })
  }, [authEnabled, configQuery.isLoading, meQuery.data, meQuery.isLoading, navigate])

  if (configQuery.isLoading || (authEnabled && meQuery.isLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading...
      </div>
    )
  }

  if (authEnabled && !meQuery.data) {
    return null
  }

  return <Outlet />
}
