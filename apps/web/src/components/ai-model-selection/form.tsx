import { useMemo, useState } from 'react'
import type { AiModelSelectionScopeType } from '@lucentdocs/shared'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface AiProviderOption {
  id: string
  name: string | null
  providerId: string
  model: string
}

interface AiModelSelectionFormProps {
  directSelection: string | null
  resolvedProviderConfigId: string
  resolvedScopeType: AiModelSelectionScopeType
  availableProviders: AiProviderOption[]
  allowInherit: boolean
  isSaving?: boolean
  onSave: (providerConfigId: string | null) => void
  saveLabel?: string
  compact?: boolean
  modeLabel?: string
}

function scopeLabel(scopeType: AiModelSelectionScopeType): string {
  switch (scopeType) {
    case 'global':
      return 'global settings'
    case 'user':
      return 'user settings'
    case 'project':
      return 'project settings'
    case 'document':
      return 'document settings'
  }
}

function formatProviderLabel(provider: AiProviderOption): string {
  return provider.name || `${provider.providerId} — ${provider.model}`
}

function normalizeDirectSelection(
  directSelection: string | null,
  availableProviders: AiProviderOption[]
): string | null {
  if (!directSelection) return null
  return availableProviders.some((provider) => provider.id === directSelection)
    ? directSelection
    : null
}

export function AiModelSelectionForm({
  directSelection,
  resolvedProviderConfigId,
  resolvedScopeType,
  availableProviders,
  allowInherit,
  isSaving = false,
  onSave,
  saveLabel = 'Save',
  compact = false,
  modeLabel = 'Mode',
}: AiModelSelectionFormProps) {
  const normalizedDirectSelection = useMemo(
    () => normalizeDirectSelection(directSelection, availableProviders),
    [directSelection, availableProviders]
  )
  const derivedMode = allowInherit && normalizedDirectSelection === null ? 'inherit' : 'custom'
  const derivedSelectedId = normalizedDirectSelection ?? resolvedProviderConfigId
  const syncToken = `${allowInherit}\0${normalizedDirectSelection}\0${resolvedProviderConfigId}`

  const [mode, setMode] = useState<'inherit' | 'custom'>(derivedMode)
  const [selectedId, setSelectedId] = useState<string>(derivedSelectedId)
  const [lastSyncToken, setLastSyncToken] = useState(syncToken)

  if (lastSyncToken !== syncToken) {
    setLastSyncToken(syncToken)
    setMode(derivedMode)
    setSelectedId(derivedSelectedId)
  }

  const resolvedProvider = useMemo(
    () => availableProviders.find((p) => p.id === resolvedProviderConfigId),
    [availableProviders, resolvedProviderConfigId]
  )

  const isDirty = useMemo(() => {
    if (allowInherit && mode === 'inherit') {
      return normalizedDirectSelection !== null
    }
    return normalizedDirectSelection !== selectedId
  }, [allowInherit, mode, normalizedDirectSelection, selectedId])

  const handleSave = () => {
    if (allowInherit && mode === 'inherit') {
      onSave(null)
    } else {
      onSave(selectedId)
    }
  }

  const handleReset = () => {
    setMode(allowInherit && normalizedDirectSelection === null ? 'inherit' : 'custom')
    setSelectedId(normalizedDirectSelection ?? resolvedProviderConfigId)
  }

  return (
    <div className={compact ? 'space-y-4' : 'space-y-5'}>
      {allowInherit ? (
        <Field>
          <FieldLabel htmlFor="ai-model-mode">{modeLabel}</FieldLabel>
          <FieldContent>
            <Select
              value={mode}
              items={{
                inherit: `Inherit from ${scopeLabel(resolvedScopeType)}`,
                custom: 'Custom override',
              }}
              onValueChange={(value) => setMode(value === 'inherit' ? 'inherit' : 'custom')}
            >
              <SelectTrigger id="ai-model-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">
                  Inherit from {scopeLabel(resolvedScopeType)}
                </SelectItem>
                <SelectItem value="custom">Custom override</SelectItem>
              </SelectContent>
            </Select>
            {!compact && (
              <FieldDescription>
                Inherit to follow the next less specific scope automatically.
              </FieldDescription>
            )}
          </FieldContent>
        </Field>
      ) : null}

      {!(allowInherit && mode === 'inherit') ? (
        <Field>
          <FieldLabel htmlFor="ai-model-select">Model</FieldLabel>
          <FieldContent>
            <Select
              value={selectedId}
              items={Object.fromEntries(
                availableProviders.map((provider) => [provider.id, formatProviderLabel(provider)])
              )}
              onValueChange={(value) => {
                if (value) setSelectedId(value)
              }}
            >
              <SelectTrigger id="ai-model-select" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableProviders.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {formatProviderLabel(provider)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!compact && (
              <FieldDescription>
                Select the AI model to use for generation in this scope.
              </FieldDescription>
            )}
          </FieldContent>
        </Field>
      ) : (
        <div className="text-muted-foreground text-sm">
          Inherited from {scopeLabel(resolvedScopeType)}:{' '}
          <span className="font-medium text-foreground">
            {resolvedProvider ? formatProviderLabel(resolvedProvider) : 'Unknown model'}
          </span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleReset}
          disabled={isSaving || !isDirty}
        >
          Reset
        </Button>
        <Button type="button" onClick={handleSave} disabled={isSaving || !isDirty}>
          {isSaving ? 'Saving…' : saveLabel}
        </Button>
      </div>
    </div>
  )
}
