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
  ProviderSectionKind,
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
  DEFAULT_EMBEDDING_PROVIDER_OPTIONS,
  EMBEDDING_RUNTIME_FIELD_KEYS,
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
  const [generationDraft, setGenerationDraft] = useState<AiDraftState | null>(null)
  const [embeddingDraft, setEmbeddingDraft] = useState<AiDraftState | null>(null)

  const configQuery = trpc.config.get.useQuery()
  const modelCatalogQuery = trpc.config.modelCatalog.useQuery()
  const aiSettingsQuery = trpc.config.aiSettings.useQuery()

  const updateMutation = trpc.config.update.useMutation()
  const updateProvidersMutation = trpc.config.updateProviders.useMutation()
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

    const incomingGeneration: AiDraftState = {
      providers: aiSettingsQuery.data.generationProviders.map(normalizeProvider),
      activeProviderId: aiSettingsQuery.data.activeGenerationProviderId,
    }
    const incomingEmbedding: AiDraftState = {
      providers: aiSettingsQuery.data.embeddingProviders.map(normalizeProvider),
      activeProviderId: aiSettingsQuery.data.activeEmbeddingProviderId,
    }

    setGenerationDraft((current) => {
      if (!current) return incomingGeneration

      const baseline = serializeAiDraft({
        providers: aiSettingsQuery.data.generationProviders.map(normalizeProvider),
        activeProviderId: aiSettingsQuery.data.activeGenerationProviderId,
      })

      const currentSerialized = serializeAiDraft(current)
      const isDirty = currentSerialized !== baseline

      return isDirty ? current : incomingGeneration
    })

    setEmbeddingDraft((current) => {
      if (!current) return incomingEmbedding

      const baseline = serializeAiDraft({
        providers: aiSettingsQuery.data.embeddingProviders.map(normalizeProvider),
        activeProviderId: aiSettingsQuery.data.activeEmbeddingProviderId,
      })

      const currentSerialized = serializeAiDraft(current)
      const isDirty = currentSerialized !== baseline

      return isDirty ? current : incomingEmbedding
    })
  }, [aiSettingsQuery.data])

  // Dirty detection
  const generationBaseline = useMemo(() => {
    if (!aiSettingsQuery.data) return null
    return serializeAiDraft({
      providers: aiSettingsQuery.data.generationProviders.map(normalizeProvider),
      activeProviderId: aiSettingsQuery.data.activeGenerationProviderId,
    })
  }, [aiSettingsQuery.data])

  const embeddingBaseline = useMemo(() => {
    if (!aiSettingsQuery.data) return null
    return serializeAiDraft({
      providers: aiSettingsQuery.data.embeddingProviders.map(normalizeProvider),
      activeProviderId: aiSettingsQuery.data.activeEmbeddingProviderId,
    })
  }, [aiSettingsQuery.data])

  const generationDirty = useMemo(() => {
    if (!generationDraft || !generationBaseline) return false
    return serializeAiDraft(generationDraft) !== generationBaseline
  }, [generationDraft, generationBaseline])

  const embeddingDirty = useMemo(() => {
    if (!embeddingDraft || !embeddingBaseline) return false
    return serializeAiDraft(embeddingDraft) !== embeddingBaseline
  }, [embeddingDraft, embeddingBaseline])

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

  const handleDiscardDraft = (kind: ProviderSectionKind) => {
    if (!aiSettingsQuery.data) return

    const nextDraft: AiDraftState =
      kind === 'embedding'
        ? {
            providers: aiSettingsQuery.data.embeddingProviders.map(normalizeProvider),
            activeProviderId: aiSettingsQuery.data.activeEmbeddingProviderId,
          }
        : {
            providers: aiSettingsQuery.data.generationProviders.map(normalizeProvider),
            activeProviderId: aiSettingsQuery.data.activeGenerationProviderId,
          }

    if (kind === 'embedding') {
      setEmbeddingDraft(nextDraft)
      return
    }

    setGenerationDraft(nextDraft)
  }

  const saveDraft = (kind: ProviderSectionKind) => {
    const draft = kind === 'embedding' ? embeddingDraft : generationDraft
    if (!draft) return

    updateProvidersMutation.mutate(
      {
        usage: kind,
        providers: draft.providers.map((provider) => ({
          id: provider.id,
          providerId: provider.providerId,
          type: provider.type,
          baseURL: provider.baseURL,
          model: provider.model,
          apiKeyId: provider.apiKeyId,
        })),
        activeProviderId: draft.activeProviderId,
      },
      {
        onSuccess: async () => {
          await Promise.all([utils.config.aiSettings.invalidate(), utils.config.get.invalidate()])
          toast.success(kind === 'embedding' ? 'Embedding providers saved' : 'AI providers saved')
        },
        onError: (error) => {
          toast.error(
            kind === 'embedding'
              ? 'Failed to save embedding providers'
              : 'Failed to save AI providers',
            {
              description: error.message,
            }
          )
        },
      }
    )
  }

  const updateProvider = useCallback(
    (kind: ProviderSectionKind, id: string, patch: Partial<AiProviderDraft>) => {
      const setter = kind === 'embedding' ? setEmbeddingDraft : setGenerationDraft
      setter((current) => {
        if (!current) return current
        return {
          ...current,
          providers: current.providers.map((item) =>
            item.id === id ? { ...item, ...patch } : item
          ),
        }
      })
    },
    []
  )

  const setActiveProvider = useCallback((kind: ProviderSectionKind, id: string) => {
    const setter = kind === 'embedding' ? setEmbeddingDraft : setGenerationDraft
    setter((current) => (current ? { ...current, activeProviderId: id } : current))
  }, [])

  const removeProvider = useCallback((kind: ProviderSectionKind, id: string) => {
    const setter = kind === 'embedding' ? setEmbeddingDraft : setGenerationDraft
    setter((current) => {
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

  const addProvider = useCallback((kind: ProviderSectionKind, options: ProviderOption[]) => {
    const setter = kind === 'embedding' ? setEmbeddingDraft : setGenerationDraft
    setter((current) => {
      if (!current) return current
      return {
        ...current,
        providers: [...current.providers, createProviderDraft(kind, options[0])],
      }
    })
  }, [])

  const refreshSourceCatalog = useCallback(
    async (
      kind: ProviderSectionKind,
      provider: AiProviderDraft,
      options: { forceRefresh?: boolean; notify?: boolean } = {}
    ) => {
      const key = sourceCatalogCacheKey(
        kind,
        provider.providerId,
        provider.type,
        provider.baseURL,
        provider.apiKeyId
      )

      setLoadingSourceCatalogMap((current) => ({ ...current, [key]: true }))

      try {
        const result = await getTrpcProxyClient().config.sourceCatalog.query({
          usage: kind,
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
          toast.success(
            kind === 'embedding' ? 'Embedding model list updated' : 'Provider model list updated',
            {
              description: `${result.provider.models.length} model${result.provider.models.length === 1 ? '' : 's'} fetched from provider endpoint.`,
            }
          )
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
    const timer = setTimeout(() => {
      const sections: Array<[ProviderSectionKind, AiDraftState | null]> = [
        ['generation', generationDraft],
        ['embedding', embeddingDraft],
      ]

      for (const [kind, draft] of sections) {
        if (!draft) continue

        for (const provider of draft.providers) {
          if (provider.baseURL.trim() && !isValidHttpBaseURL(provider.baseURL)) continue

          const key = sourceCatalogCacheKey(
            kind,
            provider.providerId,
            provider.type,
            provider.baseURL,
            provider.apiKeyId
          )
          if (sourceCatalogMap[key] || loadingSourceCatalogMap[key] || sourceCatalogErrorMap[key]) {
            continue
          }
          void refreshSourceCatalog(kind, provider)
        }
      }
    }, 350)

    return () => clearTimeout(timer)
  }, [
    embeddingDraft,
    generationDraft,
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
            ;[setGenerationDraft, setEmbeddingDraft].forEach((setter) => {
              setter((current) => {
                if (!current) return current
                if (!current.providers.some((p) => p.apiKeyId === id)) return current
                return {
                  ...current,
                  providers: current.providers.map((p) =>
                    p.apiKeyId === id ? { ...p, apiKeyId: null } : p
                  ),
                }
              })
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

  const embeddingProviderOptions = useMemo<ProviderOption[]>(
    () => DEFAULT_EMBEDDING_PROVIDER_OPTIONS,
    []
  )

  const embeddingProviderOptionByValue = useMemo(
    () => new Map(embeddingProviderOptions.map((option) => [option.value, option])),
    [embeddingProviderOptions]
  )

  const mapProvidersWithCatalog = useCallback(
    (kind: ProviderSectionKind, draft: AiDraftState | null): ProviderWithCatalog[] => {
      if (!draft) return []

      return draft.providers.map((provider) => {
        const key = sourceCatalogCacheKey(
          kind,
          provider.providerId,
          provider.type,
          provider.baseURL,
          provider.apiKeyId
        )
        const dynamicCatalog = sourceCatalogMap[key]
        const embeddingOption = embeddingProviderOptionByValue.get(provider.providerId)
        const fallbackCatalog =
          kind === 'generation'
            ? (providerCatalogById.get(provider.providerId) ?? null)
            : embeddingOption
              ? {
                  id: provider.providerId,
                  name: embeddingOption.label,
                  type: provider.type,
                  iconURL:
                    embeddingOption.iconURL ??
                    `https://models.dev/logos/${provider.providerId}.svg`,
                  docURL: embeddingOption.docURL ?? null,
                  apiBaseURL: embeddingOption.apiBaseURL || provider.baseURL,
                }
              : null
        const catalog = dynamicCatalog?.provider ?? fallbackCatalog

        return {
          provider,
          catalog,
          catalogSource:
            dynamicCatalog?.source ?? (kind === 'generation' ? 'models.dev' : 'provider'),
          warning: dynamicCatalog?.warning ?? sourceCatalogErrorMap[key] ?? null,
          isCatalogLoading: loadingSourceCatalogMap[key] === true,
        }
      })
    },
    [
      embeddingProviderOptionByValue,
      loadingSourceCatalogMap,
      providerCatalogById,
      sourceCatalogErrorMap,
      sourceCatalogMap,
    ]
  )

  const generationProvidersWithCatalog = useMemo(
    () => mapProvidersWithCatalog('generation', generationDraft),
    [generationDraft, mapProvidersWithCatalog]
  )

  const embeddingProvidersWithCatalog = useMemo(
    () => mapProvidersWithCatalog('embedding', embeddingDraft),
    [embeddingDraft, mapProvidersWithCatalog]
  )

  const uniqueProviderBaseURLs = useMemo(() => {
    return getUniqueProviderBaseURLs([
      ...(generationDraft?.providers ?? []),
      ...(embeddingDraft?.providers ?? []),
    ])
  }, [embeddingDraft, generationDraft])

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
    !generationDraft ||
    !embeddingDraft
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

  const renderProviderSection = (options: {
    kind: ProviderSectionKind
    title: string
    description: string
    draft: AiDraftState
    entries: ProviderWithCatalog[]
    providerOptions: ProviderOption[]
    isDirty: boolean
    isSaving: boolean
  }) => (
    <Card>
      <CardHeader>
        <CardTitle>{options.title}</CardTitle>
        <CardDescription>{options.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            {options.draft.providers.length === 0
              ? 'No providers configured.'
              : `${options.draft.providers.length} provider${options.draft.providers.length === 1 ? '' : 's'} configured`}
          </div>
          <div className="flex items-center gap-2">
            {options.isDirty && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={options.isSaving}
                onClick={() => handleDiscardDraft(options.kind)}
              >
                <RotateCcw data-icon="inline-start" />
                Discard
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => addProvider(options.kind, options.providerOptions)}
            >
              <Plus data-icon="inline-start" />
              Add provider
            </Button>
            {options.isDirty && (
              <Button
                type="button"
                size="sm"
                disabled={options.isSaving}
                onClick={() => saveDraft(options.kind)}
              >
                <Save data-icon="inline-start" />
                {options.isSaving ? 'Saving…' : 'Save providers'}
              </Button>
            )}
          </div>
        </div>

        {options.draft.providers.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-12 text-center">
            <p className="text-muted-foreground text-sm">No providers configured yet.</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => addProvider(options.kind, options.providerOptions)}
            >
              <Plus data-icon="inline-start" />
              Add your first provider
            </Button>
          </div>
        )}

        {options.entries.map((entry, index) => (
          <ProviderCard
            key={entry.provider.id}
            kind={options.kind}
            entry={entry}
            index={index}
            providerOptions={options.providerOptions}
            apiKeys={aiSettingsQuery.data.apiKeys}
            isActive={options.draft.activeProviderId === entry.provider.id}
            canRemove={options.draft.providers.length > 1}
            onUpdate={(id, patch) => updateProvider(options.kind, id, patch)}
            onSetActive={(id) => setActiveProvider(options.kind, id)}
            onRemove={(id) => removeProvider(options.kind, id)}
            onRefreshCatalog={(provider, refreshOptions) =>
              void refreshSourceCatalog(options.kind, provider, refreshOptions)
            }
          />
        ))}
      </CardContent>
    </Card>
  )

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
          {renderProviderSection({
            kind: 'generation',
            title: 'AI Providers',
            description:
              'Configure text generation providers and their models. Provider settings are stored in the database and take effect immediately.',
            draft: generationDraft,
            entries: generationProvidersWithCatalog,
            providerOptions,
            isDirty: generationDirty,
            isSaving:
              updateProvidersMutation.isPending &&
              updateProvidersMutation.variables?.usage === 'generation',
          })}

          {renderProviderSection({
            kind: 'embedding',
            title: 'Embedding Providers',
            description:
              'Configure embedding providers and their models. OpenRouter embedding catalogs are fetched live from the provider endpoint.',
            draft: embeddingDraft,
            entries: embeddingProvidersWithCatalog,
            providerOptions: embeddingProviderOptions,
            isDirty: embeddingDirty,
            isSaving:
              updateProvidersMutation.isPending &&
              updateProvidersMutation.variables?.usage === 'embedding',
          })}

          <Card>
            <CardHeader>
              <CardTitle>API Keys</CardTitle>
              <CardDescription>
                API keys are shared by generation and embedding providers using the same base URL.
              </CardDescription>
            </CardHeader>
            <CardContent>
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
                <CardTitle>Embeddings Runtime</CardTitle>
                <CardDescription>
                  Controls how document changes are debounced and batched before embeddings are
                  regenerated.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 sm:grid-cols-2">
                {EMBEDDING_RUNTIME_FIELD_KEYS.map(renderNumberField)}
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
