import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import {
  DEFAULT_PERSISTED_CONFIG,
  editableConfigSchema,
  type EditableConfigInput,
} from '@plotline/shared'
import { AlertTriangle, ArrowLeft, Eye, EyeOff, RotateCcw, Save } from 'lucide-react'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'

type ConfigFormValues = EditableConfigInput

type FieldSource = 'env' | 'file' | 'default'

function sourceBadge(source: FieldSource): {
  label: string
  variant: 'outline' | 'secondary' | 'ghost'
} {
  if (source === 'env') return { label: 'Env Override', variant: 'outline' }
  if (source === 'file') return { label: 'Config File', variant: 'secondary' }
  return { label: 'Default', variant: 'ghost' }
}

function formatDisplayValue(value: string | number): string {
  if (typeof value === 'number') return value.toLocaleString()
  return value || '(empty)'
}

export function AdminConfigPage() {
  const navigate = useNavigate()
  const [showApiKey, setShowApiKey] = useState(false)
  const configQuery = trpc.config.get.useQuery()
  const updateMutation = trpc.config.update.useMutation()
  const utils = trpc.useUtils()
  type ConfigQueryData = NonNullable<typeof configQuery.data>

  const toFormValues = useCallback(
    (data: ConfigQueryData | undefined): ConfigFormValues => ({
      AI_API_KEY: data
        ? String(data.fields.AI_API_KEY.fileValue ?? DEFAULT_PERSISTED_CONFIG.AI_API_KEY)
        : DEFAULT_PERSISTED_CONFIG.AI_API_KEY,
      AI_BASE_URL: data
        ? String(data.fields.AI_BASE_URL.fileValue ?? DEFAULT_PERSISTED_CONFIG.AI_BASE_URL)
        : DEFAULT_PERSISTED_CONFIG.AI_BASE_URL,
      AI_MODEL: data
        ? String(data.fields.AI_MODEL.fileValue ?? DEFAULT_PERSISTED_CONFIG.AI_MODEL)
        : DEFAULT_PERSISTED_CONFIG.AI_MODEL,
      YJS_PERSISTENCE_FLUSH_MS: data
        ? Number(
            data.fields.YJS_PERSISTENCE_FLUSH_MS.fileValue ??
              DEFAULT_PERSISTED_CONFIG.YJS_PERSISTENCE_FLUSH_MS
          )
        : DEFAULT_PERSISTED_CONFIG.YJS_PERSISTENCE_FLUSH_MS,
      YJS_VERSION_INTERVAL_MS: data
        ? Number(
            data.fields.YJS_VERSION_INTERVAL_MS.fileValue ??
              DEFAULT_PERSISTED_CONFIG.YJS_VERSION_INTERVAL_MS
          )
        : DEFAULT_PERSISTED_CONFIG.YJS_VERSION_INTERVAL_MS,
    }),
    []
  )

  const form = useForm<ConfigFormValues>({
    resolver: zodResolver(editableConfigSchema),
    defaultValues: toFormValues(configQuery.data ?? undefined),
  })

  const queryValues = useMemo(
    () => toFormValues(configQuery.data ?? undefined),
    [configQuery.data, toFormValues]
  )

  useEffect(() => {
    if (!configQuery.data) return
    if (form.formState.isDirty) return
    form.reset(queryValues)
  }, [configQuery.data, form, form.formState.isDirty, queryValues])

  const handleDiscard = () => {
    form.reset(queryValues)
  }

  const onSubmit = form.handleSubmit((values) => {
    updateMutation.mutate(values, {
      onSuccess: async (payload) => {
        const overriddenCount = payload.overriddenChangedKeys.length
        const effectiveCount = payload.changedEffectiveKeys.length
        const changedCount = payload.changedFileKeys.length

        form.reset(toFormValues(payload))
        await utils.config.get.invalidate()

        toast.success(changedCount === 0 ? 'No config changes detected' : 'Configuration saved', {
          description:
            changedCount === 0
              ? 'All values already matched config.toml.'
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

  if (configQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading configuration...</p>
      </div>
    )
  }

  if (configQuery.error || !configQuery.data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-destructive">
          {configQuery.error?.message ?? 'Unable to load configuration'}
        </p>
        <Button variant="outline" onClick={() => navigate('/')}>
          Back to projects
        </Button>
      </div>
    )
  }

  const fields = configQuery.data.fields
  const runtime = configQuery.data.runtime

  const aiSource = sourceBadge(fields.AI_API_KEY.source)
  const baseUrlSource = sourceBadge(fields.AI_BASE_URL.source)
  const modelSource = sourceBadge(fields.AI_MODEL.source)
  const flushSource = sourceBadge(fields.YJS_PERSISTENCE_FLUSH_MS.source)
  const versionSource = sourceBadge(fields.YJS_VERSION_INTERVAL_MS.source)
  const hostSource = sourceBadge(fields.HOST.source)
  const portSource = sourceBadge(fields.PORT.source)
  const nodeEnvSource = sourceBadge(fields.NODE_ENV.source)

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <div className="mb-10 flex items-end justify-between">
          <div>
            <Button variant="ghost" size="sm" className="-ml-2 mb-3" onClick={() => navigate('/')}>
              <ArrowLeft data-icon="inline-start" />
              Projects
            </Button>
            <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
            <p className="text-muted-foreground mt-1">Manage Plotline's configuration.</p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="lg"
              form="config-form"
              disabled={!form.formState.isDirty || updateMutation.isPending}
              onClick={handleDiscard}
            >
              <RotateCcw data-icon="inline-start" />
              Discard
            </Button>
            <Button
              type="submit"
              size="lg"
              form="config-form"
              disabled={!form.formState.isDirty || updateMutation.isPending}
            >
              <Save data-icon="inline-start" />
              {updateMutation.isPending ? 'Saving...' : 'Save changes'}
            </Button>
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

        <form id="config-form" className="grid gap-6" onSubmit={onSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>AI</CardTitle>
              <CardDescription>
                Changes apply immediately unless the field is currently overridden by an environment
                variable.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              <Field>
                <div className="flex items-center gap-2">
                  <FieldLabel htmlFor="ai-api-key">API key</FieldLabel>
                  <Badge variant={aiSource.variant}>{aiSource.label}</Badge>
                </div>
                <InputGroup>
                  <InputGroupInput
                    id="ai-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    autoComplete="off"
                    placeholder="sk-..."
                    {...form.register('AI_API_KEY')}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                      onClick={() => setShowApiKey((value) => !value)}
                    >
                      {showApiKey ? <EyeOff /> : <Eye />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  Hidden by default. Current effective value is returned by the API.
                </FieldDescription>
                {fields.AI_API_KEY.isOverridden && (
                  <FieldDescription>
                    Env var override is active. Runtime uses environment value even after save.
                  </FieldDescription>
                )}
                <FieldError>{form.formState.errors.AI_API_KEY?.message}</FieldError>
              </Field>

              <Field>
                <div className="flex items-center gap-2">
                  <FieldLabel htmlFor="ai-base-url">Base URL</FieldLabel>
                  <Badge variant={baseUrlSource.variant}>{baseUrlSource.label}</Badge>
                </div>
                <Input
                  id="ai-base-url"
                  autoComplete="off"
                  placeholder="https://api.openai.com/v1"
                  {...form.register('AI_BASE_URL')}
                />
                <FieldDescription>
                  Leave empty to use provider defaults derived from the model name.
                </FieldDescription>
                {fields.AI_BASE_URL.isOverridden && (
                  <FieldDescription>
                    Runtime currently uses env override:{' '}
                    <code>{formatDisplayValue(fields.AI_BASE_URL.effectiveValue)}</code>
                  </FieldDescription>
                )}
                <FieldError>{form.formState.errors.AI_BASE_URL?.message}</FieldError>
              </Field>

              <Field>
                <div className="flex items-center gap-2">
                  <FieldLabel htmlFor="ai-model">Model</FieldLabel>
                  <Badge variant={modelSource.variant}>{modelSource.label}</Badge>
                </div>
                <Input
                  id="ai-model"
                  autoComplete="off"
                  placeholder="gpt-5"
                  {...form.register('AI_MODEL')}
                />
                <FieldDescription>Model ID passed to your AI provider.</FieldDescription>
                {fields.AI_MODEL.isOverridden && (
                  <FieldDescription>
                    Runtime currently uses env override:{' '}
                    <code>{formatDisplayValue(fields.AI_MODEL.effectiveValue)}</code>
                  </FieldDescription>
                )}
                <FieldError>{form.formState.errors.AI_MODEL?.message}</FieldError>
              </Field>
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
              <Field>
                <div className="flex items-center gap-2">
                  <FieldLabel htmlFor="flush-ms">Flush interval (ms)</FieldLabel>
                  <Badge variant={flushSource.variant}>{flushSource.label}</Badge>
                </div>
                <Input
                  id="flush-ms"
                  type="number"
                  autoComplete="off"
                  min={100}
                  step={100}
                  {...form.register('YJS_PERSISTENCE_FLUSH_MS', { valueAsNumber: true })}
                />
                <FieldDescription>How often dirty documents flush to SQLite.</FieldDescription>
                {fields.YJS_PERSISTENCE_FLUSH_MS.isOverridden && (
                  <FieldDescription>
                    Runtime currently uses env override:{' '}
                    <code>
                      {formatDisplayValue(fields.YJS_PERSISTENCE_FLUSH_MS.effectiveValue)} ms
                    </code>
                  </FieldDescription>
                )}
                <FieldError>{form.formState.errors.YJS_PERSISTENCE_FLUSH_MS?.message}</FieldError>
              </Field>

              <Field>
                <div className="flex items-center gap-2">
                  <FieldLabel htmlFor="snapshot-ms">Snapshot interval (ms)</FieldLabel>
                  <Badge variant={versionSource.variant}>{versionSource.label}</Badge>
                </div>
                <Input
                  id="snapshot-ms"
                  type="number"
                  autoComplete="off"
                  min={1000}
                  step={1000}
                  {...form.register('YJS_VERSION_INTERVAL_MS', { valueAsNumber: true })}
                />
                <FieldDescription>
                  How often active documents auto-create version snapshots.
                </FieldDescription>
                {fields.YJS_VERSION_INTERVAL_MS.isOverridden && (
                  <FieldDescription>
                    Runtime currently uses env override:{' '}
                    <code>
                      {formatDisplayValue(fields.YJS_VERSION_INTERVAL_MS.effectiveValue)} ms
                    </code>
                  </FieldDescription>
                )}
                <FieldError>{form.formState.errors.YJS_VERSION_INTERVAL_MS?.message}</FieldError>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Server</CardTitle>
              <CardDescription>Read-only values currently active on the server.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="bg-muted/40 rounded-xl border px-3 py-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-muted-foreground text-sm">Host</p>
                  <Badge variant={hostSource.variant}>{hostSource.label}</Badge>
                </div>
                <p className="font-medium">{runtime.host}</p>
              </div>
              <div className="bg-muted/40 rounded-xl border px-3 py-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-muted-foreground text-sm">Port</p>
                  <Badge variant={portSource.variant}>{portSource.label}</Badge>
                </div>
                <p className="font-medium">{runtime.port}</p>
              </div>
              <div className="bg-muted/40 rounded-xl border px-3 py-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-muted-foreground text-sm">Environment</p>
                  <Badge variant={nodeEnvSource.variant}>{nodeEnvSource.label}</Badge>
                </div>
                <p className="font-medium">{runtime.nodeEnv}</p>
              </div>
              <div className="bg-muted/40 rounded-xl border px-3 py-2">
                <p className="text-muted-foreground mb-1 text-sm">Config file</p>
                <p className="font-mono text-xs">{runtime.configFilePath}</p>
              </div>
              <div className="bg-muted/40 rounded-xl border px-3 py-2 sm:col-span-2">
                <p className="text-muted-foreground mb-1 text-sm">Data directory</p>
                <p className="font-mono text-xs">{runtime.dataDir}</p>
              </div>
            </CardContent>
          </Card>
        </form>
      </div>
    </div>
  )
}
