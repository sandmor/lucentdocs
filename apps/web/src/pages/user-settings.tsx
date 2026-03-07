import { ArrowLeft, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { IndexingStrategyForm } from '@/components/indexing/strategy-form'
import { trpc } from '@/lib/trpc'

export function UserSettingsPage() {
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const query = trpc.indexing.getUser.useQuery()
  const mutation = trpc.indexing.updateUser.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.indexing.getUser.invalidate(),
        utils.indexing.getProject.invalidate(),
        utils.indexing.getDocument.invalidate(),
      ])
      toast.success('User indexing strategy updated')
    },
    onError: (error) => {
      toast.error('Failed to update user indexing strategy', {
        description: error.message,
      })
    },
  })

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-12">
        <div className="mb-6">
          <Button variant="ghost" size="sm" className="-ml-2 mb-3" onClick={() => navigate('/')}>
            <ArrowLeft data-icon="inline-start" />
            Projects
          </Button>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">My settings</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            Configure your personal indexing defaults.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Indexing strategy</CardTitle>
            <CardDescription>
              This applies to your projects unless a project or document override is set.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {query.isLoading || !query.data ? (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" />
                Loading settings…
              </div>
            ) : (
              <IndexingStrategyForm
                allowInherit
                directStrategy={query.data.user?.strategy ?? null}
                resolvedStrategy={query.data.resolved.strategy}
                resolvedScopeType={query.data.resolved.scopeType}
                isSaving={mutation.isPending}
                saveLabel="Save user override"
                onSave={(strategy) => mutation.mutate({ strategy })}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
