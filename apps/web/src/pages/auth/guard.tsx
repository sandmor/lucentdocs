import { useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router'
import { trpc } from '@/lib/trpc'
import { PageLoader } from '@/components/ui/page-loader'

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
    return <PageLoader message="Authenticating…" />
  }

  if (authEnabled && !meQuery.data) {
    return null
  }

  return <Outlet />
}
