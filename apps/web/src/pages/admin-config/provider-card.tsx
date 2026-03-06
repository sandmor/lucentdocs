import { useState } from 'react'
import { AI_PROVIDER_DEFAULT_BASE_URLS, normalizeBaseURL } from '@lucentdocs/shared'
import { Check, RefreshCcw, Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@/components/ui/combobox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

import type {
  AiApiKeySummary,
  AiProviderDraft,
  OptionItem,
  ProviderSectionKind,
  ProviderOption,
  ProviderWithCatalog,
} from './types'
import { defaultModelForProvider, hasCatalogModels } from './constants'

interface ProviderCardProps {
  kind: ProviderSectionKind
  entry: ProviderWithCatalog
  index: number
  providerOptions: ProviderOption[]
  apiKeys: AiApiKeySummary[]
  isActive: boolean
  canRemove: boolean
  onUpdate: (id: string, patch: Partial<AiProviderDraft>) => void
  onSetActive: (id: string) => void
  onRemove: (id: string) => void
  onRefreshCatalog: (
    provider: AiProviderDraft,
    options?: { forceRefresh?: boolean; notify?: boolean }
  ) => void
}

export function ProviderCard({
  kind,
  entry,
  index,
  providerOptions,
  apiKeys,
  isActive,
  canRemove,
  onUpdate,
  onSetActive,
  onRemove,
  onRefreshCatalog,
}: ProviderCardProps) {
  const [providerAnchor, setProviderAnchor] = useState<HTMLButtonElement | null>(null)
  const [modelAnchor, setModelAnchor] = useState<HTMLButtonElement | null>(null)
  const [apiKeyAnchor, setApiKeyAnchor] = useState<HTMLButtonElement | null>(null)

  const provider = entry.provider
  const resolvedBaseURL = provider.baseURL.trim() || AI_PROVIDER_DEFAULT_BASE_URLS[provider.type]

  const selectedProviderOption =
    providerOptions.find((item) => item.value === provider.providerId) ??
    (entry.catalog
      ? {
          value: entry.catalog.id,
          label: entry.catalog.name,
          type: entry.catalog.type,
          apiBaseURL: entry.catalog.apiBaseURL,
          iconURL: entry.catalog.iconURL,
          docURL: entry.catalog.docURL,
        }
      : {
          value: provider.providerId,
          label: provider.providerId,
          type: provider.type,
          apiBaseURL: resolvedBaseURL,
          iconURL: `https://models.dev/logos/${provider.providerId}.svg`,
          docURL: null,
        })

  const providerModels: OptionItem[] = (
    hasCatalogModels(entry.catalog) ? entry.catalog.models : []
  ).map((model) => ({
    value: model.id,
    label: model.name ?? model.id,
  }))

  if (provider.model && !providerModels.some((model) => model.value === provider.model)) {
    providerModels.unshift({
      value: provider.model,
      label: provider.model,
    })
  }

  const selectedModelOption: OptionItem | null = provider.model
    ? (providerModels.find((m) => m.value === provider.model) ?? {
        value: provider.model,
        label: provider.model,
      })
    : null

  const selectedModelMetadata = hasCatalogModels(entry.catalog)
    ? (entry.catalog.models.find((model) => model.id === provider.model) ?? null)
    : null

  const isEmbedding = kind === 'embedding'

  const keyOptions: OptionItem[] = [
    { value: '__none__', label: 'Auto (default key for URL)' },
    ...apiKeys
      .filter((key) => normalizeBaseURL(key.baseURL) === normalizeBaseURL(resolvedBaseURL))
      .map((key) => ({
        value: key.id,
        label: `${key.name || 'Unnamed'} (${key.maskedKey})${key.isDefault ? ' ★' : ''}`,
      })),
  ]

  const selectedApiKeyOption =
    keyOptions.find((item) => item.value === (provider.apiKeyId ?? '__none__')) ?? keyOptions[0]

  return (
    <div
      className={`rounded-xl border p-4 ${isActive ? 'border-primary/25 bg-primary/3' : 'bg-muted/20'}`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <img
              src={selectedProviderOption.iconURL}
              alt={selectedProviderOption.label}
              className="size-5 shrink-0 rounded-sm"
            />
            <p className="truncate font-medium">{selectedProviderOption.label}</p>
            {isActive && (
              <Badge variant="secondary" className="shrink-0">
                Active
              </Badge>
            )}
          </div>
          <p className="ml-7 mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            {provider.model ? (
              <>
                <span className="truncate">{provider.model}</span>
                <span className="shrink-0">·</span>
              </>
            ) : null}
            <span className="shrink-0 text-xs">
              {entry.catalogSource === 'provider' ? 'Live catalog' : 'models.dev'}
            </span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={entry.isCatalogLoading}
                  onClick={() => onRefreshCatalog(provider, { forceRefresh: true, notify: true })}
                />
              }
            >
              <RefreshCcw className={entry.isCatalogLoading ? 'animate-spin' : ''} />
            </TooltipTrigger>
            <TooltipContent>
              {isEmbedding ? 'Refresh embedding models' : 'Refresh models'}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant={isActive ? 'secondary' : 'ghost'}
                  size="icon-sm"
                  onClick={() => onSetActive(provider.id)}
                />
              }
            >
              <Check />
            </TooltipTrigger>
            <TooltipContent>{isActive ? 'Active provider' : 'Set as active'}</TooltipContent>
          </Tooltip>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={!canRemove}
                  title="Remove provider"
                />
              }
            >
              <Trash2 />
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove provider #{index + 1}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the <strong>{selectedProviderOption.label}</strong> configuration.
                  Unsaved changes will be discarded when you save.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => onRemove(provider.id)}>Remove</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel>Provider</FieldLabel>
          <Combobox
            items={providerOptions}
            itemToStringLabel={(item) => item.label}
            itemToStringValue={(item) => item.value}
            isItemEqualToValue={(item, value) => item.value === value.value}
            value={selectedProviderOption}
            onValueChange={(value) => {
              if (!value) return
              const patch: Partial<AiProviderDraft> = {
                providerId: value.value,
                type: value.type,
                baseURL: value.apiBaseURL || AI_PROVIDER_DEFAULT_BASE_URLS[value.type],
                model: defaultModelForProvider(kind, value.type),
                apiKeyId: null,
              }
              onUpdate(provider.id, patch)
              // Auto-fetch catalog for the newly selected provider
              onRefreshCatalog({ ...provider, ...patch })
            }}
          >
            <ComboboxTrigger
              render={
                <Button
                  ref={setProviderAnchor}
                  variant="outline"
                  className="w-full justify-between overflow-hidden"
                />
              }
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <img
                  src={selectedProviderOption.iconURL}
                  alt={selectedProviderOption.label}
                  className="size-4 shrink-0 rounded-sm"
                />
                <span className="truncate">{selectedProviderOption.label}</span>
              </span>
            </ComboboxTrigger>
            <ComboboxContent anchor={providerAnchor}>
              <ComboboxInput placeholder="Search providers…" showClear />
              <ComboboxEmpty>No providers found.</ComboboxEmpty>
              <ComboboxList>
                {(item: ProviderOption) => (
                  <ComboboxItem value={item}>
                    <span className="inline-flex items-center gap-2">
                      <img src={item.iconURL} alt={item.label} className="size-4 rounded-sm" />
                      {item.label}
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </Field>

        <Field>
          <FieldLabel htmlFor={`provider-base-url-${provider.id}`}>Base URL</FieldLabel>
          <Input
            id={`provider-base-url-${provider.id}`}
            value={provider.baseURL}
            onChange={(event) => {
              onUpdate(provider.id, {
                baseURL: event.target.value,
                apiKeyId: null,
              })
            }}
            placeholder={
              selectedProviderOption.value === 'custom'
                ? 'http://localhost:11434/v1'
                : AI_PROVIDER_DEFAULT_BASE_URLS[provider.type]
            }
            autoComplete="off"
          />
          <FieldDescription className="truncate">
            Resolved: <code>{resolvedBaseURL}</code>
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel>{isEmbedding ? 'Embedding model' : 'Model'}</FieldLabel>
          {providerModels.length > 0 ? (
            <Combobox
              items={providerModels}
              itemToStringLabel={(item) => item.label}
              itemToStringValue={(item) => item.value}
              isItemEqualToValue={(item, value) => item.value === value.value}
              value={selectedModelOption}
              onValueChange={(value) => {
                if (!value) return
                onUpdate(provider.id, { model: value.value })
              }}
            >
              <ComboboxTrigger
                render={
                  <Button
                    ref={setModelAnchor}
                    variant="outline"
                    className="w-full justify-between overflow-hidden font-normal"
                  />
                }
              >
                <span className="truncate">
                  {provider.model || <span className="text-muted-foreground">Select model…</span>}
                </span>
              </ComboboxTrigger>
              <ComboboxContent anchor={modelAnchor}>
                <ComboboxInput placeholder="Search models…" showClear />
                <ComboboxEmpty>No matching models.</ComboboxEmpty>
                <ComboboxList>
                  {(item: OptionItem) => <ComboboxItem value={item}>{item.label}</ComboboxItem>}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          ) : (
            <Input
              value={provider.model}
              onChange={(event) => {
                onUpdate(provider.id, { model: event.target.value })
              }}
              placeholder="e.g. gpt-5, claude-sonnet-4-5"
            />
          )}
          {providerModels.length > 0 && (
            <Input
              className="mt-1"
              value={provider.model}
              onChange={(event) => {
                onUpdate(provider.id, { model: event.target.value })
              }}
              placeholder="Or type a custom model ID"
            />
          )}
          {selectedModelMetadata?.contextLength ? (
            <FieldDescription>
              Context length: {selectedModelMetadata.contextLength.toLocaleString()} tokens
            </FieldDescription>
          ) : null}
          {isEmbedding && selectedModelMetadata?.description ? (
            <FieldDescription className="line-clamp-3">
              {selectedModelMetadata.description}
            </FieldDescription>
          ) : null}
          {entry.isCatalogLoading && (
            <FieldDescription className="text-muted-foreground">Loading models…</FieldDescription>
          )}
          {entry.warning && (
            <FieldDescription className="text-amber-600 dark:text-amber-400">
              {entry.warning}
            </FieldDescription>
          )}
        </Field>

        <Field>
          <FieldLabel>API Key</FieldLabel>
          <Combobox
            items={keyOptions}
            itemToStringLabel={(item) => item.label}
            itemToStringValue={(item) => item.value}
            isItemEqualToValue={(item, value) => item.value === value.value}
            value={selectedApiKeyOption}
            onValueChange={(value) => {
              onUpdate(provider.id, {
                apiKeyId: !value || value.value === '__none__' ? null : value.value,
              })
            }}
          >
            <ComboboxTrigger
              render={
                <Button
                  ref={setApiKeyAnchor}
                  variant="outline"
                  className="w-full justify-between font-normal"
                />
              }
            >
              <span className="truncate">{selectedApiKeyOption.label}</span>
            </ComboboxTrigger>
            <ComboboxContent anchor={apiKeyAnchor}>
              <ComboboxInput placeholder="Search API keys…" showClear />
              <ComboboxEmpty>No keys for this base URL.</ComboboxEmpty>
              <ComboboxList>
                {(item: OptionItem) => <ComboboxItem value={item}>{item.label}</ComboboxItem>}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <FieldDescription>
            {keyOptions.length <= 1
              ? 'Add an API key below to link it here.'
              : `${keyOptions.length - 1} key${keyOptions.length > 2 ? 's' : ''} for this URL.`}
          </FieldDescription>
        </Field>
      </div>
    </div>
  )
}
