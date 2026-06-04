import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { IndexingStrategyForm } from '@/components/indexing/strategy-form'
import { AiModelSelectionForm } from '@/components/ai-model-selection/form'
import { trpc } from '@/lib/trpc'

interface ProjectSettings {
  projectId: string
}

export function ProjectSettings({ projectId }: ProjectSettings) {
  const utils = trpc.useUtils()
  const meQuery = trpc.auth.me.useQuery()
  const projectQuery = trpc.projects.get.useQuery({ id: projectId })
  const query = trpc.indexing.getProject.useQuery({ projectId })
  const aiModelQuery = trpc.aiModelSelection.getProject.useQuery({ projectId })
  const embeddingModelQuery = trpc.embeddingModelSelection.getProject.useQuery({ projectId })
  const aiProvidersQuery = trpc.aiModelSelection.availableProviders.useQuery()
  const embeddingProvidersQuery = trpc.embeddingModelSelection.availableProviders.useQuery()
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

  const aiModelMutation = trpc.aiModelSelection.updateProject.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.aiModelSelection.getProject.invalidate({ projectId }),
        utils.aiModelSelection.getDocument.invalidate(),
      ])
      toast.success('Project AI model updated')
    },
    onError: (error) => {
      toast.error('Failed to update project AI model', {
        description: error.message,
      })
    },
  })

  const embeddingModelMutation = trpc.embeddingModelSelection.updateProject.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.embeddingModelSelection.getProject.invalidate({ projectId }),
        utils.embeddingModelSelection.getDocument.invalidate(),
      ])
      toast.success('Project embedding model updated')
    },
    onError: (error) => {
      toast.error('Failed to update project embedding model', {
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
          <CardTitle>Project AI model</CardTitle>
          <CardDescription>
            Configure the default generation model for documents in this project.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {aiModelQuery.isLoading ||
          !aiModelQuery.data ||
          aiProvidersQuery.isLoading ||
          !aiProvidersQuery.data ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Loading settings…
            </div>
          ) : (
            <AiModelSelectionForm
              allowInherit
              compact
              directSelection={aiModelQuery.data.project?.providerConfigId ?? null}
              resolvedProviderConfigId={aiModelQuery.data.resolved.providerConfigId}
              resolvedScopeType={aiModelQuery.data.resolved.scopeType}
              availableProviders={aiProvidersQuery.data}
              isSaving={aiModelMutation.isPending}
              saveLabel="Save project override"
              onSave={(providerConfigId) => aiModelMutation.mutate({ projectId, providerConfigId })}
            />
          )}
        </CardContent>
      </Card>

      <Card className="overflow-visible">
        <CardHeader>
          <CardTitle>Project embedding model</CardTitle>
          <CardDescription>
            Configure the default embedding model for documents owned only by this project. Shared
            documents use a document override or the global default.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {embeddingModelQuery.isLoading ||
          !embeddingModelQuery.data ||
          embeddingProvidersQuery.isLoading ||
          !embeddingProvidersQuery.data ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Loading settings…
            </div>
          ) : (
            <AiModelSelectionForm
              allowInherit
              compact
              directSelection={embeddingModelQuery.data.project?.providerConfigId ?? null}
              resolvedProviderConfigId={embeddingModelQuery.data.resolved.providerConfigId}
              resolvedScopeType={embeddingModelQuery.data.resolved.scopeType}
              availableProviders={embeddingProvidersQuery.data}
              isSaving={embeddingModelMutation.isPending}
              saveLabel="Save project override"
              modeLabel="Embedding model mode"
              onSave={(providerConfigId) =>
                embeddingModelMutation.mutate({ projectId, providerConfigId })
              }
            />
          )}
        </CardContent>
      </Card>

      <Card className="overflow-visible">
        <CardHeader>
          <CardTitle>Project indexing</CardTitle>
          <CardDescription>
            Configure the default indexing strategy for documents owned only by this project. Shared
            documents use a document override or the global default.
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
