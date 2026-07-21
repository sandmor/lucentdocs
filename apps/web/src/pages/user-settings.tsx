import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { IndexingStrategyForm } from '@/components/indexing/strategy-form'
import { AiModelSelectionForm } from '@/components/ai-model-selection/form'
import { trpc } from '@/lib/trpc'
import { PageLoader } from '@/components/ui/page-loader'
import { TypographySettingsForm } from '@/components/editor/typography-settings-form'
import { AssistantSettingsForm } from '@/components/editor/assistant-settings-form'

export function UserSettingsPage() {
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const query = trpc.indexing.getUser.useQuery()
  const aiModelQuery = trpc.aiModelSelection.getUser.useQuery()
  const embeddingModelQuery = trpc.embeddingModelSelection.getUser.useQuery()
  const aiProvidersQuery = trpc.aiModelSelection.availableProviders.useQuery()
  const embeddingProvidersQuery = trpc.embeddingModelSelection.availableProviders.useQuery()
  const typographyQuery = trpc.editorPreferences.getUser.useQuery()
  const typographyMutation = trpc.editorPreferences.updateUser.useMutation({
    onSuccess: () => {
      utils.editorPreferences.getUser.invalidate()
      utils.editorPreferences.getDocument.invalidate()
      toast.success('Typography settings updated')
    },
  })
  const assistantQuery = trpc.assistantPreferences.getUser.useQuery()
  const assistantMutation = trpc.assistantPreferences.updateUser.useMutation({
    onSuccess: () => {
      utils.assistantPreferences.getUser.invalidate()
      utils.assistantPreferences.getProject.invalidate()
      toast.success('Assistant defaults updated')
    },
  })

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

  const aiModelMutation = trpc.aiModelSelection.updateUser.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.aiModelSelection.getUser.invalidate(),
        utils.aiModelSelection.getProject.invalidate(),
        utils.aiModelSelection.getDocument.invalidate(),
      ])
      toast.success('User AI model updated')
    },
    onError: (error) => {
      toast.error('Failed to update user AI model', {
        description: error.message,
      })
    },
  })

  const embeddingModelMutation = trpc.embeddingModelSelection.updateUser.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.embeddingModelSelection.getUser.invalidate(),
        utils.embeddingModelSelection.getProject.invalidate(),
        utils.embeddingModelSelection.getDocument.invalidate(),
      ])
      toast.success('User embedding model updated')
    },
    onError: (error) => {
      toast.error('Failed to update user embedding model', {
        description: error.message,
      })
    },
  })

  const isLoading =
    query.isLoading ||
    aiModelQuery.isLoading ||
    embeddingModelQuery.isLoading ||
    aiProvidersQuery.isLoading ||
    embeddingProvidersQuery.isLoading ||
    !query.data

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
            Configure your personal defaults.
          </p>
        </div>

        {isLoading ||
        !aiModelQuery.data ||
        !embeddingModelQuery.data ||
        !aiProvidersQuery.data ||
        !embeddingProvidersQuery.data ? (
          <PageLoader variant="inline" message="Loading settings…" />
        ) : (
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Project Assistant</CardTitle>
                <CardDescription>Choose how new project conversations start. You can still switch mode in each chat.</CardDescription>
              </CardHeader>
              <CardContent>
                {assistantQuery.data ? (
                  <AssistantSettingsForm
                    key={JSON.stringify(assistantQuery.data.user)}
                    direct={assistantQuery.data.user}
                    resolved={assistantQuery.data.resolved}
                    allowInherit
                    onSave={(overrides) => assistantMutation.mutate({ overrides })}
                    isSaving={assistantMutation.isPending}
                  />
                ) : <PageLoader variant="inline" message="Loading assistant defaults…" />}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Typography</CardTitle>
                <CardDescription>
                  Controls quote normalization while you type. Paste and AI text are unchanged.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {typographyQuery.data ? (
                  <TypographySettingsForm
                    key={JSON.stringify(typographyQuery.data.user)}
                    direct={typographyQuery.data.user}
                    resolved={typographyQuery.data.resolved}
                    allowInherit
                    onSave={(overrides) => typographyMutation.mutate({ overrides })}
                    isSaving={typographyMutation.isPending}
                  />
                ) : (
                  <PageLoader variant="inline" message="Loading typography…" />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>AI model</CardTitle>
                <CardDescription>
                  This applies to your projects unless a project or document override is set.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AiModelSelectionForm
                  allowInherit
                  directSelection={aiModelQuery.data.user?.providerConfigId ?? null}
                  resolvedProviderConfigId={aiModelQuery.data.resolved.providerConfigId}
                  resolvedScopeType={aiModelQuery.data.resolved.scopeType}
                  availableProviders={aiProvidersQuery.data}
                  isSaving={aiModelMutation.isPending}
                  saveLabel="Save user override"
                  onSave={(providerConfigId) => aiModelMutation.mutate({ providerConfigId })}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Embedding model</CardTitle>
                <CardDescription>
                  This applies to documents owned only by your projects unless a project or document
                  override is set. Shared documents use a document override or the global default.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AiModelSelectionForm
                  allowInherit
                  directSelection={embeddingModelQuery.data.user?.providerConfigId ?? null}
                  resolvedProviderConfigId={embeddingModelQuery.data.resolved.providerConfigId}
                  resolvedScopeType={embeddingModelQuery.data.resolved.scopeType}
                  availableProviders={embeddingProvidersQuery.data}
                  isSaving={embeddingModelMutation.isPending}
                  saveLabel="Save user override"
                  modeLabel="Embedding model mode"
                  onSave={(providerConfigId) => embeddingModelMutation.mutate({ providerConfigId })}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Indexing strategy</CardTitle>
                <CardDescription>
                  This applies to documents owned only by your projects unless a project or document
                  override is set. Shared documents use a document override or the global default.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <IndexingStrategyForm
                  allowInherit
                  directStrategy={query.data.user?.strategy ?? null}
                  resolvedStrategy={query.data.resolved.strategy}
                  resolvedScopeType={query.data.resolved.scopeType}
                  isSaving={mutation.isPending}
                  saveLabel="Save user override"
                  onSave={(strategy) => mutation.mutate({ strategy })}
                />
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
