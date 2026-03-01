import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import {
  DEFAULT_PERSISTED_CONFIG,
  EDITABLE_CONFIG_KEYS,
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
type EditableFieldKey = keyof ConfigFormValues
type NumberFieldKey = {
  [Key in EditableFieldKey]: ConfigFormValues[Key] extends number ? Key : never
}[EditableFieldKey]
type StringFieldKey = Exclude<EditableFieldKey, NumberFieldKey>

type FieldSource = 'env' | 'file' | 'default'
type ConfigFieldPayload = {
  effectiveValue: string | number
  fileValue: string | number | null
  source: FieldSource
  isOverridden: boolean
}
type RuntimeFieldKey = 'host' | 'port' | 'nodeEnv'
type ConfigQueryData = {
  fields: Record<EditableFieldKey | RuntimeFieldKey, ConfigFieldPayload>
  runtime: {
    nodeEnv: string
    host: string
    port: number
    configFilePath: string
    dataDir: string
    isLoopbackHost: boolean
  }
}
type EditableFieldMeta =
  | {
      kind: 'secret'
      id: string
      label: string
      description: string
      placeholder?: string
    }
  | {
      kind: 'text'
      id: string
      label: string
      description: string
      placeholder?: string
    }
  | {
      kind: 'number'
      id: string
      label: string
      description: string
      overrideSuffix?: string
    }

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

const EDITABLE_FIELD_META: Record<EditableFieldKey, EditableFieldMeta> = {
  aiApiKey: {
    kind: 'secret',
    id: 'ai-api-key',
    label: 'API key',
    description: 'Hidden by default. Current effective value is returned by the API.',
    placeholder: 'sk-...',
  },
  aiBaseUrl: {
    kind: 'text',
    id: 'ai-base-url',
    label: 'Base URL',
    description: 'Leave empty to use provider defaults derived from the model name.',
    placeholder: 'https://api.openai.com/v1',
  },
  aiModel: {
    kind: 'text',
    id: 'ai-model',
    label: 'Model',
    description: 'Model ID passed to your AI provider.',
    placeholder: 'gpt-5',
  },
  yjsPersistenceFlushMs: {
    kind: 'number',
    id: 'flush-ms',
    label: 'Flush interval (ms)',
    description: 'How often dirty documents flush to SQLite.',
    overrideSuffix: ' ms',
  },
  yjsVersionIntervalMs: {
    kind: 'number',
    id: 'snapshot-ms',
    label: 'Snapshot interval (ms)',
    description: 'How often active documents auto-create version snapshots.',
    overrideSuffix: ' ms',
  },
  maxContextChars: {
    kind: 'number',
    id: 'max-context',
    label: 'Context chars',
    description: 'Max characters for AI context.',
  },
  maxHintChars: {
    kind: 'number',
    id: 'max-hint',
    label: 'Hint chars',
    description: 'Max characters for hints.',
  },
  maxPromptChars: {
    kind: 'number',
    id: 'max-prompt',
    label: 'Prompt chars',
    description: 'Max characters for prompts.',
  },
  maxToolEntries: {
    kind: 'number',
    id: 'max-tool-entries',
    label: 'Tool entries',
    description: 'Max entries returned by tools.',
  },
  maxToolReadChars: {
    kind: 'number',
    id: 'max-tool-read',
    label: 'Tool read chars',
    description: 'Max characters read by tools.',
  },
  maxChatMessageChars: {
    kind: 'number',
    id: 'max-chat-msg',
    label: 'Chat message chars',
    description: 'Max characters per chat message.',
  },
  maxPromptNameChars: {
    kind: 'number',
    id: 'max-prompt-name',
    label: 'Prompt name chars',
    description: 'Max prompt name length.',
  },
  maxPromptDescChars: {
    kind: 'number',
    id: 'max-prompt-desc',
    label: 'Prompt desc chars',
    description: 'Max prompt description length.',
  },
  maxPromptSystemChars: {
    kind: 'number',
    id: 'max-prompt-system',
    label: 'Prompt system chars',
    description: 'Max system prompt length.',
  },
  maxPromptUserChars: {
    kind: 'number',
    id: 'max-prompt-user',
    label: 'Prompt user chars',
    description: 'Max user prompt length.',
  },
  maxDocImportChars: {
    kind: 'number',
    id: 'max-doc-import',
    label: 'Doc import chars',
    description: 'Max characters for document import.',
  },
  maxDocExportChars: {
    kind: 'number',
    id: 'max-doc-export',
    label: 'Doc export chars',
    description: 'Max characters for document export.',
  },
}

const AI_FIELD_KEYS = [
  'aiApiKey',
  'aiBaseUrl',
  'aiModel',
] as const satisfies ReadonlyArray<EditableFieldKey>
const COLLABORATION_FIELD_KEYS = [
  'yjsPersistenceFlushMs',
  'yjsVersionIntervalMs',
] as const satisfies ReadonlyArray<EditableFieldKey>
const LIMIT_FIELD_ROWS = [
  {
    keys: ['maxContextChars', 'maxHintChars', 'maxPromptChars'],
    columnsClassName: 'sm:grid-cols-3',
  },
  {
    keys: ['maxToolEntries', 'maxToolReadChars', 'maxChatMessageChars'],
    columnsClassName: 'sm:grid-cols-3',
  },
  {
    keys: [
      'maxPromptNameChars',
      'maxPromptDescChars',
      'maxPromptSystemChars',
      'maxPromptUserChars',
    ],
    columnsClassName: 'sm:grid-cols-2',
  },
  {
    keys: ['maxDocImportChars', 'maxDocExportChars'],
    columnsClassName: 'sm:grid-cols-2',
  },
] as const satisfies ReadonlyArray<{
  keys: ReadonlyArray<EditableFieldKey>
  columnsClassName: string
}>

function toFormValues(data: ConfigQueryData | undefined): ConfigFormValues {
  const values: Partial<Record<EditableFieldKey, string | number>> = {}

  for (const key of EDITABLE_CONFIG_KEYS) {
    const fallback = DEFAULT_PERSISTED_CONFIG[key]
    const rawValue = data?.fields[key].fileValue ?? fallback
    values[key] = typeof fallback === 'number' ? Number(rawValue) : String(rawValue)
  }

  return values as ConfigFormValues
}

export function AdminConfigPage() {
  const navigate = useNavigate()
  const [showApiKey, setShowApiKey] = useState(false)
  const configQuery = trpc.config.get.useQuery()
  const updateMutation = trpc.config.update.useMutation()
  const utils = trpc.useUtils()

  const form = useForm<ConfigFormValues>({
    resolver: zodResolver(editableConfigSchema),
    defaultValues: toFormValues(configQuery.data),
  })

  const queryValues = toFormValues(configQuery.data)

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

  const renderEditableField = (key: EditableFieldKey) => {
    const meta = EDITABLE_FIELD_META[key]
    const fieldState = fields[key]
    const badge = sourceBadge(fieldState.source)
    const errorMessage = form.formState.errors[key]?.message

    const sharedDescription = (
      <FieldDescription key={`${key}-description`}>{meta.description}</FieldDescription>
    )

    const overrideDescription =
      meta.kind === 'secret' ? (
        <FieldDescription key={`${key}-override`}>
          Env var override is active. Runtime uses environment value even after save.
        </FieldDescription>
      ) : (
        <FieldDescription key={`${key}-override`}>
          Runtime currently uses env override:{' '}
          <code>
            {formatDisplayValue(fieldState.effectiveValue)}
            {meta.kind === 'number' ? (meta.overrideSuffix ?? '') : ''}
          </code>
        </FieldDescription>
      )

    const inputControl =
      meta.kind === 'secret' ? (
        <InputGroup>
          <InputGroupInput
            id={meta.id}
            type={showApiKey ? 'text' : 'password'}
            autoComplete="off"
            placeholder={meta.placeholder}
            {...form.register(key as StringFieldKey)}
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
      ) : (
        <Input
          id={meta.id}
          type={meta.kind === 'number' ? 'number' : 'text'}
          autoComplete="off"
          placeholder={meta.kind === 'text' ? meta.placeholder : undefined}
          {...(meta.kind === 'number'
            ? form.register(key as NumberFieldKey, { valueAsNumber: true })
            : form.register(key as StringFieldKey))}
        />
      )

    return (
      <Field key={key}>
        <div className="flex items-center gap-2">
          <FieldLabel htmlFor={meta.id}>{meta.label}</FieldLabel>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        {inputControl}
        {sharedDescription}
        {fieldState.isOverridden && overrideDescription}
        <FieldError>{errorMessage}</FieldError>
      </Field>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-12">
        <div className="mb-6 sm:mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Button variant="ghost" size="sm" className="-ml-2 mb-3" onClick={() => navigate('/')}>
              <ArrowLeft data-icon="inline-start" />
              Projects
            </Button>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Settings</h1>
            <p className="text-muted-foreground mt-1 text-sm sm:text-base">
              Manage Plotline's configuration.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="sm:size-auto sm:px-3 sm:py-2"
              form="config-form"
              disabled={!form.formState.isDirty || updateMutation.isPending}
              onClick={handleDiscard}
            >
              <RotateCcw data-icon="inline-start" />
              Discard
            </Button>
            <Button
              type="submit"
              size="sm"
              className="sm:size-auto sm:px-3 sm:py-2"
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
              {AI_FIELD_KEYS.map(renderEditableField)}
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
              {COLLABORATION_FIELD_KEYS.map(renderEditableField)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Limits</CardTitle>
              <CardDescription>
                Character and entry limits for various operations. Changes take effect immediately.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              {LIMIT_FIELD_ROWS.map((row) => (
                <div key={row.keys.join('-')} className={`grid gap-4 ${row.columnsClassName}`}>
                  {row.keys.map(renderEditableField)}
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
