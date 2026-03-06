import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { editableConfigSchema } from '@lucentdocs/shared'
import { AlertTriangle, ArrowLeft, Plus, RotateCcw, Save } from 'lucide-react'

import { getTrpcProxyClient, trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

import type {
  AiDraftState,
  AiProviderDraft,
  ConfigFormValues,
  ModelCatalogProviderSummary,
  NumberFieldKey,
  ProviderOption,
  ProviderWithCatalog,
  SourceModelCatalogResult,
  VisibleNumberFieldKey,
} from './types'
import {
  AI_TUNING_FIELD_KEYS,
  COLLABORATION_FIELD_KEYS,
  DEFAULT_PROVIDER_OPTIONS,
  LIMIT_FIELD_ROWS,
  VISIBLE_FIELD_META,
  createProviderDraft,
  formatDisplayValue,
  getUniqueProviderBaseURLs,
  isValidHttpBaseURL,
  normalizeProvider,
  serializeAiDraft,
  sourceBadge,
  sourceCatalogCacheKey,
  toFormValues,
} from './constants'
import { ProviderCard } from './provider-card'
import { ApiKeyManager } from './api-key-manager'

export function AdminConfigPage() {
  const navigate = useNavigate()

  // Source catalog caching
  const [sourceCatalogMap, setSourceCatalogMap] = useState<
    Record<string, SourceModelCatalogResult>
  >({})
  const [loadingSourceCatalogMap, setLoadingSourceCatalogMap] = useState<Record<string, boolean>>(
    {}
  )
  const [sourceCatalogErrorMap, setSourceCatalogErrorMap] = useState<Record<string, string>>({})

  // AI provider draft state
  const [aiDraft, setAiDraft] = useState<AiDraftState | null>(null)

  const configQuery = trpc.config.get.useQuery()
  const modelCatalogQuery = trpc.config.modelCatalog.useQuery()
  const aiSettingsQuery = trpc.config.aiSettings.useQuery()

  const updateMutation = trpc.config.update.useMutation()
  const updateAiSettingsMutation = trpc.config.updateAiSettings.useMutation()
  const createAiKeyMutation = trpc.config.createAiApiKey.useMutation()
  const updateAiKeyMutation = trpc.config.updateAiApiKey.useMutation()
  const deleteAiKeyMutation = trpc.config.deleteAiApiKey.useMutation()

  const utils = trpc.useUtils()

  // Config form (for non-provider config fields)
  const form = useForm<ConfigFormValues>({
    resolver: zodResolver(editableConfigSchema),
    defaultValues: toFormValues(configQuery.data),
  })

  useEffect(() => {
    if (!configQuery.data) return
    if (form.formState.isDirty) return
    form.reset(toFormValues(configQuery.data))
  }, [configQuery.data, form, form.formState.isDirty])

  // Sync AI draft from server
  useEffect(() => {
    if (!aiSettingsQuery.data) return

    const incoming: AiDraftState = {
      providers: aiSettingsQuery.data.providers.map(normalizeProvider),
      activeProviderId: aiSettingsQuery.data.activeProviderId,
    }

    setAiDraft((current) => {
      if (!current) return incoming

      const baseline = serializeAiDraft({
        providers: aiSettingsQuery.data.providers.map(normalizeProvider),
        activeProviderId: aiSettingsQuery.data.activeProviderId,
      })

      const currentSerialized = serializeAiDraft(current)
      const isDirty = currentSerialized !== baseline

      return isDirty ? current : incoming
    })
  }, [aiSettingsQuery.data])

  // Dirty detection
  const aiBaseline = useMemo(() => {
    if (!aiSettingsQuery.data) return null
    return serializeAiDraft({
      providers: aiSettingsQuery.data.providers.map(normalizeProvider),
      activeProviderId: aiSettingsQuery.data.activeProviderId,
    })
  }, [aiSettingsQuery.data])

  const aiDirty = useMemo(() => {
    if (!aiDraft || !aiBaseline) return false
    return serializeAiDraft(aiDraft) !== aiBaseline
  }, [aiDraft, aiBaseline])

  const handleDiscard = () => {
    form.reset(toFormValues(configQuery.data))
  }

  const onSubmit = form.handleSubmit((values) => {
    updateMutation.mutate(values, {
      onSuccess: async (payload) => {
        const overriddenCount = payload.overriddenChangedKeys.length
        const effectiveCount = payload.changedEffectiveKeys.length
        const changedCount = payload.changedPersistedKeys.length

        form.reset(toFormValues(payload))
        await utils.config.get.invalidate()

        toast.success(changedCount === 0 ? 'No config changes detected' : 'Configuration saved', {
          description:
            changedCount === 0
              ? 'All values already matched persisted database settings.'
              : overriddenCount > 0
                ? `${effectiveCount} applied now, ${overriddenCount} overridden by env vars.`
                : `${effectiveCount} applied immediately with no restart.`,
        })
      },
      onError: (error) => {
        toast.error('Failed to update configuration', {
          description: error.message,
        })
      },
    })
  })

  const handleDiscardAiDraft = () => {
    if (!aiSettingsQuery.data) return
    setAiDraft({
      providers: aiSettingsQuery.data.providers.map(normalizeProvider),
      activeProviderId: aiSettingsQuery.data.activeProviderId,
    })
  }

  const saveAiDraft = () => {
    if (!aiDraft) return

    updateAiSettingsMutation.mutate(
      {
        providers: aiDraft.providers.map((provider) => ({
          id: provider.id,
          providerId: provider.providerId,
          type: provider.type,
          baseURL: provider.baseURL,
          model: provider.model,
          apiKeyId: provider.apiKeyId,
        })),
        activeProviderId: aiDraft.activeProviderId,
      },
      {
        onSuccess: async () => {
          await Promise.all([utils.config.aiSettings.invalidate(), utils.config.get.invalidate()])
          toast.success('AI providers saved')
        },
        onError: (error) => {
          toast.error('Failed to save AI providers', {
            description: error.message,
          })
        },
      }
    )
  }

  const updateProvider = useCallback((id: string, patch: Partial<AiProviderDraft>) => {
    setAiDraft((current) => {
      if (!current) return current
      return {
        ...current,
        providers: current.providers.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      }
    })
  }, [])

  const setActiveProvider = useCallback((id: string) => {
    setAiDraft((current) => (current ? { ...current, activeProviderId: id } : current))
  }, [])

  const removeProvider = useCallback((id: string) => {
    setAiDraft((current) => {
      if (!current) return current

      const nextProviders = current.providers.filter((item) => item.id !== id)
      const nextActiveProviderId =
        current.activeProviderId === id ? (nextProviders[0]?.id ?? null) : current.activeProviderId

      return {
        providers: nextProviders,
        activeProviderId: nextActiveProviderId,
      }
    })
  }, [])

  const addProvider = useCallback((options: ProviderOption[]) => {
    setAiDraft((current) => {
      if (!current) return current
      return {
        ...current,
        providers: [...current.providers, createProviderDraft(options[0])],
      }
    })
  }, [])

  const refreshSourceCatalog = useCallback(
    async (
      provider: AiProviderDraft,
      options: { forceRefresh?: boolean; notify?: boolean } = {}
    ) => {
      const key = sourceCatalogCacheKey(
        provider.providerId,
        provider.type,
        provider.baseURL,
        provider.apiKeyId
      )

      setLoadingSourceCatalogMap((current) => ({ ...current, [key]: true }))

      try {
        const result = await getTrpcProxyClient().config.sourceModelCatalog.query({
          providerId: provider.providerId,
          type: provider.type,
          baseURL: provider.baseURL,
          apiKeyId: provider.apiKeyId,
          forceRefresh: options.forceRefresh === true,
        })

        setSourceCatalogMap((current) => ({ ...current, [key]: result }))
        setSourceCatalogErrorMap((current) => {
          if (!current[key]) return current
          const next = { ...current }
          delete next[key]
          return next
        })

        if (options.notify && result.source === 'provider') {
          toast.success('Provider model list updated', {
            description: `${result.provider.models.length} models fetched from provider endpoint.`,
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setSourceCatalogErrorMap((current) => ({ ...current, [key]: message }))

        if (options.notify) {
          toast.error('Failed to refresh source models', { description: message })
        }
      } finally {
        setLoadingSourceCatalogMap((current) => ({ ...current, [key]: false }))
      }
    },
    []
  )

  useEffect(() => {
    if (!aiDraft) return

    const timer = setTimeout(() => {
      for (const provider of aiDraft.providers) {
        if (provider.baseURL.trim() && !isValidHttpBaseURL(provider.baseURL)) continue

        const key = sourceCatalogCacheKey(
          provider.providerId,
          provider.type,
          provider.baseURL,
          provider.apiKeyId
        )
        if (sourceCatalogMap[key] || loadingSourceCatalogMap[key] || sourceCatalogErrorMap[key]) {
          continue
        }
        void refreshSourceCatalog(provider)
      }
    }, 350)

    return () => clearTimeout(timer)
  }, [
    aiDraft,
    loadingSourceCatalogMap,
    refreshSourceCatalog,
    sourceCatalogErrorMap,
    sourceCatalogMap,
  ])

  const handleCreateApiKey = useCallback(
    (input: { baseURL: string; name?: string; apiKey: string }) => {
      createAiKeyMutation.mutate(
        {
          baseURL: input.baseURL,
          name: input.name,
          apiKey: input.apiKey,
        },
        {
          onSuccess: async () => {
            await utils.config.aiSettings.refetch()
            toast.success('API key created')
          },
          onError: (error) => {
            toast.error('Failed to create API key', { description: error.message })
          },
        }
      )
    },
    [createAiKeyMutation, utils.config.aiSettings]
  )

  const handleUpdateApiKey = useCallback(
    (input: { id: string; name?: string; apiKey?: string; isDefault?: boolean }) => {
      updateAiKeyMutation.mutate(input, {
        onSuccess: async () => {
          await utils.config.aiSettings.refetch()
          toast.success(input.isDefault ? 'Default API key updated' : 'API key updated')
        },
        onError: (error) => {
          toast.error('Failed to update API key', { description: error.message })
        },
      })
    },
    [updateAiKeyMutation, utils.config.aiSettings]
  )

  const handleDeleteApiKey = useCallback(
    (id: string) => {
      deleteAiKeyMutation.mutate(
        { id },
        {
          onSuccess: async () => {
            await utils.config.aiSettings.refetch()
            // Nullify stale apiKeyId references in the draft so no provider
            // silently points to a key that no longer exists.
            setAiDraft((current) => {
              if (!current) return current
              if (!current.providers.some((p) => p.apiKeyId === id)) return current
              return {
                ...current,
                providers: current.providers.map((p) =>
                  p.apiKeyId === id ? { ...p, apiKeyId: null } : p
                ),
              }
            })
            toast.success('API key removed')
          },
          onError: (error) => {
            toast.error('Failed to remove API key', { description: error.message })
          },
        }
      )
    },
    [deleteAiKeyMutation, utils.config.aiSettings]
  )

  const providerOptions = useMemo<ProviderOption[]>(() => {
    const fromCatalog =
      modelCatalogQuery.data?.providers.map((provider) => ({
        value: provider.id,
        label: provider.name,
        type: provider.type,
        apiBaseURL: provider.apiBaseURL,
        iconURL: provider.iconURL,
        docURL: provider.docURL,
      })) ?? []

    const options = fromCatalog.length > 0 ? fromCatalog : DEFAULT_PROVIDER_OPTIONS.slice(0, 2)

    // Always append the "Custom" option
    const customOption = DEFAULT_PROVIDER_OPTIONS.find((o) => o.value === 'custom')
    if (customOption && !options.some((o) => o.value === 'custom')) {
      options.push(customOption)
    }

    return options
  }, [modelCatalogQuery.data?.providers])

  const providerCatalogById = useMemo(() => {
    const map = new Map<string, ModelCatalogProviderSummary>()
    for (const provider of modelCatalogQuery.data?.providers ?? []) {
      map.set(provider.id, provider)
    }
    return map
  }, [modelCatalogQuery.data?.providers])

  const providersWithCatalog: ProviderWithCatalog[] = useMemo(() => {
    if (!aiDraft) return []

    return aiDraft.providers.map((provider) => {
      const key = sourceCatalogCacheKey(
        provider.providerId,
        provider.type,
        provider.baseURL,
        provider.apiKeyId
      )
      const dynamicCatalog = sourceCatalogMap[key]
      const fallbackCatalog = providerCatalogById.get(provider.providerId) ?? null
      const catalog = dynamicCatalog?.provider ?? fallbackCatalog

      return {
        provider,
        catalog,
        catalogSource: dynamicCatalog?.source ?? 'models.dev',
        warning: dynamicCatalog?.warning ?? sourceCatalogErrorMap[key] ?? null,
        isCatalogLoading: loadingSourceCatalogMap[key] === true,
      }
    })
  }, [
    aiDraft,
    loadingSourceCatalogMap,
    providerCatalogById,
    sourceCatalogErrorMap,
    sourceCatalogMap,
  ])

  const uniqueProviderBaseURLs = useMemo(() => {
    return aiDraft ? getUniqueProviderBaseURLs(aiDraft.providers) : []
  }, [aiDraft])

  if (configQuery.isLoading || aiSettingsQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading configuration…</p>
      </div>
    )
  }

  if (
    configQuery.error ||
    !configQuery.data ||
    aiSettingsQuery.error ||
    !aiSettingsQuery.data ||
    !aiDraft
  ) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-destructive">
          {configQuery.error?.message ??
            aiSettingsQuery.error?.message ??
            'Unable to load configuration'}
        </p>
        <Button variant="outline" onClick={() => navigate('/')}>
          Back to projects
        </Button>
      </div>
    )
  }

  const fields = configQuery.data.fields
  const runtime = configQuery.data.runtime

  const renderNumberField = (key: VisibleNumberFieldKey) => {
    const meta = VISIBLE_FIELD_META[key]
    const fieldState = fields[key]
    const badge = sourceBadge(fieldState.source)
    const errorMessage = form.formState.errors[key]?.message

    return (
      <Field key={key}>
        <div className="flex items-center gap-2">
          <FieldLabel htmlFor={meta.id}>{meta.label}</FieldLabel>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        <Input
          id={meta.id}
          type="number"
          autoComplete="off"
          {...form.register(key as NumberFieldKey, { valueAsNumber: true })}
        />
        <FieldDescription>{meta.description}</FieldDescription>
        {fieldState.isOverridden && (
          <FieldDescription>
            Runtime currently uses env override:{' '}
            <code>
              {formatDisplayValue(fieldState.effectiveValue)}
              {meta.overrideSuffix ?? ''}
            </code>
          </FieldDescription>
        )}
        <FieldError>{errorMessage}</FieldError>
      </Field>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-12">
        <div className="mb-6 sm:mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Button variant="ghost" size="sm" className="-ml-2 mb-3" onClick={() => navigate('/')}>
              <ArrowLeft data-icon="inline-start" />
              Projects
            </Button>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Settings</h1>
            <p className="text-muted-foreground mt-1 text-sm sm:text-base">
              Manage LucentDocs&apos;s configuration.
            </p>
          </div>
        </div>

        {!runtime.isLoopbackHost && (
          <div className="mb-6">
            <Card className="border-destructive/35 bg-destructive/5">
              <CardHeader className="gap-2">
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="text-destructive size-4" />
                  Server is exposed beyond loopback
                </CardTitle>
                <CardDescription className="text-foreground/80">
                  Current host is <code>{runtime.host}</code>. Without auth, this settings page is
                  open to anyone who can reach this server.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        )}

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>AI Providers</CardTitle>
              <CardDescription>
                Configure AI providers and their models. Provider settings are stored in the
                database and take effect immediately.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-muted-foreground">
                  {aiDraft.providers.length === 0
                    ? 'No providers configured.'
                    : `${aiDraft.providers.length} provider${aiDraft.providers.length === 1 ? '' : 's'} configured`}
                </div>
                <div className="flex items-center gap-2">
                  {aiDirty && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={updateAiSettingsMutation.isPending}
                      onClick={handleDiscardAiDraft}
                    >
                      <RotateCcw data-icon="inline-start" />
                      Discard
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addProvider(providerOptions)}
                  >
                    <Plus data-icon="inline-start" />
                    Add provider
                  </Button>
                  {aiDirty && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={updateAiSettingsMutation.isPending}
                      onClick={saveAiDraft}
                    >
                      <Save data-icon="inline-start" />
                      {updateAiSettingsMutation.isPending ? 'Saving…' : 'Save providers'}
                    </Button>
                  )}
                </div>
              </div>

              {aiDraft.providers.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-12 text-center">
                  <p className="text-muted-foreground text-sm">No AI providers configured yet.</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => addProvider(providerOptions)}
                  >
                    <Plus data-icon="inline-start" />
                    Add your first provider
                  </Button>
                </div>
              )}

              {providersWithCatalog.map((entry, index) => (
                <ProviderCard
                  key={entry.provider.id}
                  entry={entry}
                  index={index}
                  providerOptions={providerOptions}
                  apiKeys={aiSettingsQuery.data.apiKeys}
                  isActive={aiDraft.activeProviderId === entry.provider.id}
                  canRemove={aiDraft.providers.length > 1}
                  onUpdate={updateProvider}
                  onSetActive={setActiveProvider}
                  onRemove={removeProvider}
                  onRefreshCatalog={(provider, options) =>
                    void refreshSourceCatalog(provider, options)
                  }
                />
              ))}

              <ApiKeyManager
                apiKeys={aiSettingsQuery.data.apiKeys}
                suggestedBaseURLs={uniqueProviderBaseURLs}
                isCreating={createAiKeyMutation.isPending}
                isUpdating={updateAiKeyMutation.isPending}
                isDeleting={deleteAiKeyMutation.isPending}
                onCreate={handleCreateApiKey}
                onUpdate={handleUpdateApiKey}
                onDelete={handleDeleteApiKey}
              />
            </CardContent>
          </Card>

          <form id="config-form" className="grid gap-6" onSubmit={onSubmit}>
            {form.formState.isDirty && (
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={updateMutation.isPending}
                  onClick={handleDiscard}
                >
                  <RotateCcw data-icon="inline-start" />
                  Discard
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  form="config-form"
                  disabled={updateMutation.isPending}
                >
                  <Save data-icon="inline-start" />
                  {updateMutation.isPending ? 'Saving…' : 'Save config'}
                </Button>
              </div>
            )}

            <Card>
              <CardHeader>
                <CardTitle>AI Runtime</CardTitle>
                <CardDescription>
                  Runtime tuning values used by prompts and generation requests.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 sm:grid-cols-3">
                {AI_TUNING_FIELD_KEYS.map(renderNumberField)}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Collaboration</CardTitle>
                <CardDescription>
                  Timer changes are hot-reloaded and take effect immediately without a process
                  restart.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 sm:grid-cols-2">
                {COLLABORATION_FIELD_KEYS.map(renderNumberField)}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Limits</CardTitle>
                <CardDescription>
                  Character and entry limits for various operations. Changes take effect
                  immediately.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6">
                {LIMIT_FIELD_ROWS.map((row) => (
                  <div key={row.keys.join('-')} className={`grid gap-4 ${row.columnsClassName}`}>
                    {row.keys.map(renderNumberField)}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Server</CardTitle>
                <CardDescription>Read-only values currently active on the server.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
                {[
                  {
                    label: 'Host',
                    value: runtime.host,
                    source: sourceBadge(fields.host.source),
                  },
                  {
                    label: 'Port',
                    value: runtime.port,
                    source: sourceBadge(fields.port.source),
                  },
                  {
                    label: 'Environment',
                    value: runtime.nodeEnv,
                    source: sourceBadge(fields.nodeEnv.source),
                  },
                ].map((item) => (
                  <div key={item.label} className="bg-muted/40 rounded-xl border px-3 py-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-muted-foreground text-sm">{item.label}</p>
                      <Badge variant={item.source.variant}>{item.source.label}</Badge>
                    </div>
                    <p className="font-medium">{item.value}</p>
                  </div>
                ))}
                <div className="bg-muted/40 rounded-xl border px-3 py-2 sm:col-span-2">
                  <p className="text-muted-foreground mb-1 text-sm">Data directory</p>
                  <p className="font-mono text-xs">{runtime.dataDir}</p>
                </div>
              </CardContent>
            </Card>
          </form>
        </div>
      </div>
    </div>
  )
}
