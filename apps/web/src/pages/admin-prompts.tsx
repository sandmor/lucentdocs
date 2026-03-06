import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import CodeMirror from '@uiw/react-codemirror'
import { json as jsonLanguage } from '@codemirror/lang-json'
import { useTheme } from 'next-themes'
import {
  promptEditableSchema,
  responseProtocolSchema,
  type LimitsConfig,
  type PromptDefinition,
  type PromptEditable,
  type PromptMode,
  type PromptSummary,
  type ResponseProtocol,
} from '@lucentdocs/shared'
import { ArrowLeft, FilePlus2, Save, Trash2, WandSparkles } from 'lucide-react'
import { toast } from 'sonner'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@/components/ui/combobox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const NONE_VALUE = '__none__'

interface PromptFormState {
  mode: PromptMode
  name: string
  description: string
  systemTemplate: string
  userTemplate: string
  protocolJson: string
  temperature: string
  maxOutputTokens: string
}

interface BindingOption {
  id: string | null
  name: string
}

function createDefaultProtocol(mode: PromptMode): ResponseProtocol {
  if (mode === 'continue' || mode === 'chat') return { type: 'plain-text-v1' }
  return { type: 'selection-edit-v1' }
}

function createEmptyForm(mode: PromptMode): PromptFormState {
  const defaultName =
    mode === 'continue'
      ? 'New Continue Prompt'
      : mode === 'prompt'
        ? 'New Selection Prompt'
        : 'New Chat Prompt'

  return {
    mode,
    name: defaultName,
    description: '',
    systemTemplate: '',
    userTemplate: '',
    protocolJson: JSON.stringify(createDefaultProtocol(mode), null, 2),
    temperature: '0.85',
    maxOutputTokens: '',
  }
}

function toFormState(prompt: PromptDefinition): PromptFormState {
  return {
    mode: prompt.mode,
    name: prompt.name,
    description: prompt.description,
    systemTemplate: prompt.systemTemplate,
    userTemplate: prompt.userTemplate,
    protocolJson: JSON.stringify(prompt.protocol, null, 2),
    temperature: String(prompt.defaults.temperature),
    maxOutputTokens:
      prompt.defaults.maxOutputTokens === undefined ? '' : String(prompt.defaults.maxOutputTokens),
  }
}

function formatJson(raw: string): string {
  const parsed = JSON.parse(raw) as unknown
  return JSON.stringify(parsed, null, 2)
}

function parseProtocol(raw: string): ResponseProtocol {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      `Protocol must be valid JSON: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  const validated = responseProtocolSchema.safeParse(parsed)
  if (!validated.success) {
    const first = validated.error.issues[0]
    throw new Error(`Invalid protocol schema: ${first?.message ?? 'Unknown error'}`)
  }
  return validated.data
}

function formatProtocol(raw: string): { value: ResponseProtocol; json: string } {
  const value = parseProtocol(raw)
  return {
    value,
    json: JSON.stringify(value, null, 2),
  }
}

function isSystemTag(
  summary: PromptSummary,
  bindings: {
    continuePromptId: string | null
    selectionEditPromptId: string | null
    chatPromptId: string | null
  }
): string[] {
  const tags: string[] = []
  if (summary.isSystem) tags.push('system')
  if (bindings.continuePromptId === summary.id) tags.push('continue default')
  if (bindings.selectionEditPromptId === summary.id) tags.push('selection-edit default')
  if (bindings.chatPromptId === summary.id) tags.push('chat default')
  return tags
}

function assertPromptWithinLimits(editable: PromptEditable, limits: LimitsConfig): void {
  if (editable.name.length > limits.promptNameChars) {
    throw new Error(`Prompt name exceeds limit of ${limits.promptNameChars} characters`)
  }
  if (editable.description.length > limits.promptDescChars) {
    throw new Error(`Prompt description exceeds limit of ${limits.promptDescChars} characters`)
  }
  if (editable.systemTemplate.length > limits.promptSystemChars) {
    throw new Error(`System template exceeds limit of ${limits.promptSystemChars} characters`)
  }
  if (editable.userTemplate.length > limits.promptUserChars) {
    throw new Error(`User template exceeds limit of ${limits.promptUserChars} characters`)
  }
}

export function AdminPromptsPage() {
  const navigate = useNavigate()
  const { resolvedTheme } = useTheme()
  const utils = trpc.useUtils()
  const limitsQuery = trpc.config.limits.useQuery()
  const listQuery = trpc.prompts.list.useQuery()
  const createMutation = trpc.prompts.create.useMutation()
  const updateMutation = trpc.prompts.update.useMutation()
  const deleteMutation = trpc.prompts.delete.useMutation()
  const setBindingMutation = trpc.prompts.setBinding.useMutation()

  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null)
  const [creatingMode, setCreatingMode] = useState<PromptMode | null>(null)
  const [form, setForm] = useState<PromptFormState>(createEmptyForm('continue'))
  const [formError, setFormError] = useState<string | null>(null)

  const selectedPromptQuery = trpc.prompts.get.useQuery(
    { id: selectedPromptId ?? '' },
    { enabled: selectedPromptId !== null && creatingMode === null }
  )

  const listData = listQuery.data
  const summaries = useMemo(() => listData?.prompts ?? [], [listData?.prompts])
  const bindings = useMemo(
    () =>
      listData?.bindings ?? {
        continuePromptId: null,
        selectionEditPromptId: null,
        chatPromptId: null,
      },
    [listData?.bindings]
  )

  const selectedSummary = summaries.find((entry) => entry.id === selectedPromptId) ?? null
  const selectedPrompt = selectedPromptQuery.data ?? null

  const continueOptions = summaries.filter((summary) => summary.mode === 'continue')
  const selectionOptions = summaries.filter((summary) => summary.mode === 'prompt')
  const chatOptions = summaries.filter((summary) => summary.mode === 'chat')
  const continueAnchor = useRef<HTMLButtonElement | null>(null)
  const selectionAnchor = useRef<HTMLButtonElement | null>(null)
  const chatAnchor = useRef<HTMLButtonElement | null>(null)
  const continueBindingOptions = useMemo<BindingOption[]>(
    () => [{ id: null, name: 'Unbound' }, ...continueOptions.map(({ id, name }) => ({ id, name }))],
    [continueOptions]
  )
  const selectionBindingOptions = useMemo<BindingOption[]>(
    () => [
      { id: null, name: 'Unbound' },
      ...selectionOptions.map(({ id, name }) => ({ id, name })),
    ],
    [selectionOptions]
  )
  const chatBindingOptions = useMemo<BindingOption[]>(
    () => [{ id: null, name: 'Unbound' }, ...chatOptions.map(({ id, name }) => ({ id, name }))],
    [chatOptions]
  )
  const selectedContinueBinding =
    continueBindingOptions.find((option) => option.id === bindings.continuePromptId) ??
    continueBindingOptions[0]
  const selectedSelectionBinding =
    selectionBindingOptions.find((option) => option.id === bindings.selectionEditPromptId) ??
    selectionBindingOptions[0]
  const selectedChatBinding =
    chatBindingOptions.find((option) => option.id === bindings.chatPromptId) ??
    chatBindingOptions[0]

  useEffect(() => {
    if (creatingMode !== null) return
    if (selectedPromptId) return
    if (summaries.length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedPromptId(summaries[0].id)
  }, [creatingMode, selectedPromptId, summaries])

  useEffect(() => {
    if (creatingMode !== null) return
    if (!selectedPrompt) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(toFormState(selectedPrompt))
    setFormError(null)
  }, [creatingMode, selectedPrompt])

  const isBusy =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    setBindingMutation.isPending

  const startCreate = (mode: PromptMode) => {
    setCreatingMode(mode)
    setSelectedPromptId(null)
    setForm(createEmptyForm(mode))
    setFormError(null)
  }

  const selectPrompt = (id: string) => {
    setCreatingMode(null)
    setSelectedPromptId(id)
    setFormError(null)
  }

  const parseFormEditable = (): { editable: PromptEditable; protocolJson: string } => {
    const formattedProtocol = formatProtocol(form.protocolJson)
    const parsedTemperature = Number.parseFloat(form.temperature)
    const parsedMaxTokens = form.maxOutputTokens.trim()
      ? Number.parseInt(form.maxOutputTokens, 10)
      : undefined

    const candidate = {
      mode: form.mode,
      name: form.name.trim(),
      description: form.description.trim(),
      systemTemplate: form.systemTemplate.trim(),
      userTemplate: form.userTemplate.trim(),
      protocol: formattedProtocol.value,
      defaults: {
        temperature: parsedTemperature,
        ...(parsedMaxTokens !== undefined ? { maxOutputTokens: parsedMaxTokens } : {}),
      },
    }

    const validated = promptEditableSchema.safeParse(candidate)
    if (!validated.success) {
      const first = validated.error.issues[0]
      throw new Error(first?.message ?? 'Prompt form is invalid.')
    }
    const limits = limitsQuery.data
    if (limits) {
      assertPromptWithinLimits(validated.data, limits)
    }

    return {
      editable: validated.data,
      protocolJson: formattedProtocol.json,
    }
  }

  const savePrompt = () => {
    setFormError(null)

    let editable: PromptEditable
    let formattedProtocolJson: string
    try {
      const parsed = parseFormEditable()
      editable = parsed.editable
      formattedProtocolJson = parsed.protocolJson
      setForm((prev) => ({ ...prev, protocolJson: formattedProtocolJson }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid prompt values'
      setFormError(message)
      toast.error('Validation failed', { description: message })
      return
    }

    if (creatingMode !== null) {
      createMutation.mutate(
        { prompt: editable },
        {
          onSuccess: async (payload) => {
            setCreatingMode(null)
            setSelectedPromptId(payload.prompt.id)
            setForm(toFormState(payload.prompt))
            await Promise.all([
              utils.prompts.list.invalidate(),
              utils.prompts.get.invalidate({ id: payload.prompt.id }),
            ])
            toast.success(`Created prompt "${payload.prompt.name}"`)
          },
          onError: (error) => {
            toast.error('Failed to create prompt', { description: error.message })
          },
        }
      )
      return
    }

    if (!selectedPromptId) {
      setFormError('Select a prompt or create a new one first.')
      return
    }

    updateMutation.mutate(
      { id: selectedPromptId, prompt: editable },
      {
        onSuccess: async (payload) => {
          await Promise.all([
            utils.prompts.list.invalidate(),
            utils.prompts.get.invalidate({ id: payload.prompt.id }),
          ])
          if (payload.clonedFromSystem) {
            setSelectedPromptId(payload.prompt.id)
            toast.success(
              `System default cloned into "${payload.prompt.name}" and rebound as default.`
            )
            return
          }
          if (payload.changed) toast.success(`Saved "${payload.prompt.name}"`)
          else toast.message('No changes to save')
        },
        onError: (error) => {
          toast.error('Failed to save prompt', { description: error.message })
        },
      }
    )
  }

  const deletePrompt = () => {
    if (!selectedPromptId) return
    const promptName = selectedSummary?.name ?? 'this prompt'
    const confirmed = window.confirm(`Delete "${promptName}"?`)
    if (!confirmed) return

    deleteMutation.mutate(
      { id: selectedPromptId },
      {
        onSuccess: async (payload) => {
          await utils.prompts.list.invalidate()
          const nextPrompts = payload.list.prompts
          setCreatingMode(null)
          setSelectedPromptId(nextPrompts[0]?.id ?? null)
          if (nextPrompts.length === 0) setForm(createEmptyForm('continue'))
          toast.success(`Deleted "${promptName}"`)
        },
        onError: (error) => {
          toast.error('Failed to delete prompt', { description: error.message })
        },
      }
    )
  }

  const updateBinding = (slot: 'continue' | 'selection-edit' | 'chat', rawValue: string | null) => {
    const promptId = rawValue === null || rawValue === NONE_VALUE ? null : rawValue
    setBindingMutation.mutate(
      { slot, promptId },
      {
        onSuccess: async (payload) => {
          await utils.prompts.list.invalidate()
          if (payload.changed) toast.success(`Updated ${slot} default`)
          else toast.message(`No binding changes for ${slot}`)
        },
        onError: (error) => {
          toast.error('Failed to update binding', { description: error.message })
        },
      }
    )
  }

  const formatProtocolJson = () => {
    try {
      const formatted = formatJson(form.protocolJson)
      setForm((prev) => ({ ...prev, protocolJson: formatted }))
      setFormError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid JSON'
      setFormError(message)
      toast.error('Cannot format protocol JSON', { description: message })
    }
  }

  if (listQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading prompts...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-12">
        <div className="mb-6 sm:mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Button variant="ghost" size="sm" className="-ml-2 mb-3" onClick={() => navigate('/')}>
              <ArrowLeft data-icon="inline-start" />
              Projects
            </Button>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Prompts</h1>
            <p className="text-muted-foreground mt-1 text-sm sm:text-base">
              Manage prompt templates and bind defaults by slot.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => startCreate('continue')}
            >
              <FilePlus2 data-icon="inline-start" />
              <span className="hidden sm:inline">New</span> Continue
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => startCreate('prompt')}
            >
              <FilePlus2 data-icon="inline-start" />
              <span className="hidden sm:inline">New</span> Selection
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => startCreate('chat')}
            >
              <FilePlus2 data-icon="inline-start" />
              <span className="hidden sm:inline">New</span> Chat
            </Button>
            <Button size="sm" disabled={isBusy} onClick={savePrompt}>
              <Save data-icon="inline-start" />
              {createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={
                isBusy ||
                creatingMode !== null ||
                !selectedPromptId ||
                selectedSummary?.isSystem === true
              }
              onClick={deletePrompt}
            >
              <Trash2 data-icon="inline-start" />
              Delete
            </Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>System Defaults</CardTitle>
                <CardDescription>Bind prompt names to runtime slots.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <Field>
                  <FieldLabel htmlFor="continue-binding">Continue</FieldLabel>
                  <Combobox
                    items={continueBindingOptions}
                    itemToStringLabel={(item) => item.name}
                    itemToStringValue={(item) => item.id ?? NONE_VALUE}
                    isItemEqualToValue={(item, value) => item.id === value.id}
                    value={selectedContinueBinding}
                    onValueChange={(value) => updateBinding('continue', value?.id ?? null)}
                  >
                    <ComboboxTrigger
                      ref={continueAnchor}
                      id="continue-binding"
                      render={<Button variant="outline" className="w-full justify-between" />}
                    >
                      {selectedContinueBinding?.name ?? 'Unbound'}
                    </ComboboxTrigger>
                    <ComboboxContent anchor={continueAnchor}>
                      <ComboboxInput placeholder="Search continue prompts" showClear />
                      <ComboboxEmpty>No prompts found.</ComboboxEmpty>
                      <ComboboxList>
                        {(item: BindingOption) => (
                          <ComboboxItem key={item.id ?? NONE_VALUE} value={item}>
                            {item.name}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                </Field>

                <Field>
                  <FieldLabel htmlFor="selection-binding">Selection Edit</FieldLabel>
                  <Combobox
                    items={selectionBindingOptions}
                    itemToStringLabel={(item) => item.name}
                    itemToStringValue={(item) => item.id ?? NONE_VALUE}
                    isItemEqualToValue={(item, value) => item.id === value.id}
                    value={selectedSelectionBinding}
                    onValueChange={(value) => updateBinding('selection-edit', value?.id ?? null)}
                  >
                    <ComboboxTrigger
                      ref={selectionAnchor}
                      id="selection-binding"
                      render={<Button variant="outline" className="w-full justify-between" />}
                    >
                      {selectedSelectionBinding?.name ?? 'Unbound'}
                    </ComboboxTrigger>
                    <ComboboxContent anchor={selectionAnchor}>
                      <ComboboxInput placeholder="Search selection prompts" showClear />
                      <ComboboxEmpty>No prompts found.</ComboboxEmpty>
                      <ComboboxList>
                        {(item: BindingOption) => (
                          <ComboboxItem key={item.id ?? NONE_VALUE} value={item}>
                            {item.name}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                </Field>

                <Field>
                  <FieldLabel htmlFor="chat-binding">Chat</FieldLabel>
                  <Combobox
                    items={chatBindingOptions}
                    itemToStringLabel={(item) => item.name}
                    itemToStringValue={(item) => item.id ?? NONE_VALUE}
                    isItemEqualToValue={(item, value) => item.id === value.id}
                    value={selectedChatBinding}
                    onValueChange={(value) => updateBinding('chat', value?.id ?? null)}
                  >
                    <ComboboxTrigger
                      ref={chatAnchor}
                      id="chat-binding"
                      render={<Button variant="outline" className="w-full justify-between" />}
                    >
                      {selectedChatBinding?.name ?? 'Unbound'}
                    </ComboboxTrigger>
                    <ComboboxContent anchor={chatAnchor}>
                      <ComboboxInput placeholder="Search chat prompts" showClear />
                      <ComboboxEmpty>No prompts found.</ComboboxEmpty>
                      <ComboboxList>
                        {(item: BindingOption) => (
                          <ComboboxItem key={item.id ?? NONE_VALUE} value={item}>
                            {item.name}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Prompt Library</CardTitle>
                <CardDescription>{summaries.length} prompts.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                {summaries.length === 0 && (
                  <p className="text-muted-foreground text-sm">No prompts yet. Create one.</p>
                )}
                {summaries.map((summary) => {
                  const tags = isSystemTag(summary, bindings)
                  return (
                    <button
                      key={summary.id}
                      type="button"
                      className="hover:bg-muted/60 flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors"
                      onClick={() => selectPrompt(summary.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{summary.name}</span>
                        <Badge variant={summary.id === selectedPromptId ? 'secondary' : 'outline'}>
                          {summary.mode}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {tags.map((tag) => (
                          <Badge key={tag} variant="outline">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </button>
                  )
                })}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Editor</CardTitle>
              <CardDescription>
                {creatingMode !== null
                  ? `Creating new ${creatingMode} prompt`
                  : selectedSummary
                    ? `Editing ${selectedSummary.name}`
                    : 'Select a prompt to edit'}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="prompt-mode">Mode</FieldLabel>
                  <Select
                    value={form.mode}
                    disabled={creatingMode === null}
                    onValueChange={(value) =>
                      setForm((prev) => {
                        const mode =
                          value === 'prompt' ? 'prompt' : value === 'chat' ? 'chat' : 'continue'
                        return {
                          ...prev,
                          mode,
                          protocolJson: JSON.stringify(createDefaultProtocol(mode), null, 2),
                        }
                      })
                    }
                  >
                    <SelectTrigger id="prompt-mode" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="continue">continue</SelectItem>
                      <SelectItem value="prompt">prompt</SelectItem>
                      <SelectItem value="chat">chat</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Mode is fixed after creation to keep slot compatibility deterministic.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="prompt-name">Name</FieldLabel>
                  <Input
                    id="prompt-name"
                    spellCheck={false}
                    maxLength={limitsQuery.data?.promptNameChars}
                    value={form.name}
                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="prompt-description">Description</FieldLabel>
                <Input
                  id="prompt-description"
                  spellCheck={false}
                  maxLength={limitsQuery.data?.promptDescChars}
                  value={form.description}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, description: event.target.value }))
                  }
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="prompt-temperature">Temperature</FieldLabel>
                  <Input
                    id="prompt-temperature"
                    type="number"
                    step="0.01"
                    min="0"
                    max="2"
                    value={form.temperature}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, temperature: event.target.value }))
                    }
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="prompt-max-output">Max output tokens (optional)</FieldLabel>
                  <Input
                    id="prompt-max-output"
                    type="number"
                    step="1"
                    min="1"
                    placeholder="Unset"
                    value={form.maxOutputTokens}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, maxOutputTokens: event.target.value }))
                    }
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="system-template">System Template</FieldLabel>
                <Textarea
                  id="system-template"
                  className="min-h-52 font-mono text-xs"
                  spellCheck={false}
                  maxLength={limitsQuery.data?.promptSystemChars}
                  value={form.systemTemplate}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, systemTemplate: event.target.value }))
                  }
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="user-template">User Template</FieldLabel>
                <Textarea
                  id="user-template"
                  className="min-h-52 font-mono text-xs"
                  spellCheck={false}
                  maxLength={limitsQuery.data?.promptUserChars}
                  value={form.userTemplate}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, userTemplate: event.target.value }))
                  }
                />
                <FieldDescription>
                  Mode-specific system values are injected automatically at runtime based on mode.
                </FieldDescription>
              </Field>

              <Field>
                <div className="flex items-center justify-between">
                  <FieldLabel htmlFor="protocol-json">Protocol (JSON)</FieldLabel>
                  <Button type="button" size="xs" variant="outline" onClick={formatProtocolJson}>
                    <WandSparkles data-icon="inline-start" />
                    Format JSON
                  </Button>
                </div>
                <CodeMirror
                  id="protocol-json"
                  value={form.protocolJson}
                  height="220px"
                  spellCheck={false}
                  extensions={[jsonLanguage()]}
                  basicSetup={{
                    lineNumbers: true,
                    foldGutter: true,
                    highlightActiveLine: true,
                  }}
                  theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                  className="cm-app-theme overflow-hidden rounded-xl border text-xs"
                  onChange={(value) => setForm((prev) => ({ ...prev, protocolJson: value }))}
                />
                <FieldDescription>
                  Schema-validated against supported protocol types.
                </FieldDescription>
              </Field>

              {selectedSummary?.isSystem && (
                <FieldDescription>
                  This is a system default prompt template. Saving will clone it into a new prompt
                  and rebind the current default slot.
                </FieldDescription>
              )}

              <FieldError>{formError}</FieldError>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
