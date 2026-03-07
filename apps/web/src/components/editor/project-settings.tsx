import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { IndexingStrategyForm } from '@/components/indexing/strategy-form'
import { trpc } from '@/lib/trpc'

interface ProjectSettings {
  projectId: string
}

export function ProjectSettings({ projectId }: ProjectSettings) {
  const utils = trpc.useUtils()
  const meQuery = trpc.auth.me.useQuery()
  const projectQuery = trpc.projects.get.useQuery({ id: projectId })
  const query = trpc.indexing.getProject.useQuery({ projectId })
  const [ownerEmail, setOwnerEmail] = useState('')

  const isCurrentUserOwner = meQuery.data?.id === projectQuery.data?.ownerUserId
  const isAdmin = meQuery.data?.role === 'admin'

  const ownerUserQuery = trpc.auth.getUser.useQuery(
    { userId: projectQuery.data?.ownerUserId ?? '' },
    { enabled: isAdmin && !isCurrentUserOwner && !!projectQuery.data?.ownerUserId }
  )

  const ownerDisplayEmail = isCurrentUserOwner ? meQuery.data?.email : ownerUserQuery.data?.email

  const mutation = trpc.indexing.updateProject.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.indexing.getProject.invalidate({ projectId }),
        utils.indexing.getDocument.invalidate(),
      ])
      toast.success('Project indexing strategy updated')
    },
    onError: (error) => {
      toast.error('Failed to update project indexing strategy', {
        description: error.message,
      })
    },
  })
  const reassignOwnerMutation = trpc.projects.reassignOwner.useMutation({
    onSuccess: async () => {
      setOwnerEmail('')
      await Promise.all([
        utils.projects.get.invalidate({ id: projectId }),
        utils.projects.list.invalidate(),
        utils.indexing.getProject.invalidate({ projectId }),
        utils.indexing.getDocument.invalidate(),
        utils.auth.getUser.invalidate(),
      ])
      toast.success('Project owner updated')
    },
    onError: (error) => {
      toast.error('Failed to update project owner', {
        description: error.message,
      })
    },
  })

  const isOwnerDirty = ownerEmail.trim().length > 0

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <Card>
        <CardHeader>
          <CardTitle>Project ownership</CardTitle>
          <CardDescription>
            The owner of a project has full permissions to manage the project and its documents.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm">
            <div className="text-muted-foreground">Current owner</div>
            <div>
              {isCurrentUserOwner || ownerUserQuery.data
                ? (ownerDisplayEmail ?? 'Unknown')
                : (projectQuery.data?.ownerUserId ?? 'Unknown')}
            </div>
          </div>

          {isAdmin ? (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                const nextOwnerEmail = ownerEmail.trim()
                if (!nextOwnerEmail) return
                reassignOwnerMutation.mutate({
                  id: projectId,
                  ownerEmail: nextOwnerEmail,
                })
              }}
            >
              <Field>
                <FieldLabel htmlFor="owner-email">New owner email</FieldLabel>
                <FieldContent>
                  <Input
                    id="owner-email"
                    type="email"
                    value={ownerEmail}
                    onChange={(event) => setOwnerEmail(event.target.value)}
                    placeholder="Enter the new owner's email"
                  />
                  <FieldDescription>The new owner must have an existing account.</FieldDescription>
                </FieldContent>
              </Field>

              <div className="flex justify-end">
                <Button type="submit" disabled={reassignOwnerMutation.isPending || !isOwnerDirty}>
                  {reassignOwnerMutation.isPending ? 'Saving…' : 'Reassign owner'}
                </Button>
              </div>
            </form>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-visible">
        <CardHeader>
          <CardTitle>Project indexing</CardTitle>
          <CardDescription>
            Configure the default indexing strategy for documents in this project.
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
              compact
              directStrategy={query.data.project?.strategy ?? null}
              resolvedStrategy={query.data.resolved.strategy}
              resolvedScopeType={query.data.resolved.scopeType}
              isSaving={mutation.isPending}
              saveLabel="Save project override"
              onSave={(strategy) => mutation.mutate({ projectId, strategy })}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
