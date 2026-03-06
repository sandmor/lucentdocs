import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
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

import type { AiApiKeySummary } from './types'
import { isValidHttpBaseURL } from './constants'

interface ApiKeyManagerProps {
  apiKeys: AiApiKeySummary[]
  suggestedBaseURLs: string[]
  isCreating: boolean
  isUpdating: boolean
  isDeleting: boolean
  onCreate: (input: { baseURL: string; name?: string; apiKey: string }) => void
  onUpdate: (input: { id: string; name?: string; apiKey?: string; isDefault?: boolean }) => void
  onDelete: (id: string) => void
}

export function ApiKeyManager({
  apiKeys,
  suggestedBaseURLs,
  isCreating,
  isUpdating,
  isDeleting,
  onCreate,
  onUpdate,
  onDelete,
}: ApiKeyManagerProps) {
  const [showNewKeyValue, setShowNewKeyValue] = useState(false)
  const [showEditingKeyValue, setShowEditingKeyValue] = useState(false)

  const [newKeyBaseURL, setNewKeyBaseURL] = useState(suggestedBaseURLs[0] ?? '')
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyValue, setNewKeyValue] = useState('')

  const [editingKeyId, setEditingKeyId] = useState<string | null>(null)
  const [editingKeyName, setEditingKeyName] = useState('')
  const [editingKeyValue, setEditingKeyValue] = useState('')

  useEffect(() => {
    const nextSuggested = suggestedBaseURLs[0] ?? ''
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNewKeyBaseURL((prev) => {
      if (prev.trim()) return prev
      if (!nextSuggested || nextSuggested === prev) return prev
      return nextSuggested
    })
  }, [suggestedBaseURLs])

  const createApiKey = () => {
    const baseURL = newKeyBaseURL.trim()
    const apiKey = newKeyValue.trim()

    if (!baseURL || !apiKey) {
      toast.error('Base URL and API key are required.')
      return
    }

    if (!isValidHttpBaseURL(baseURL)) {
      toast.error('Base URL must be a valid http(s) URL.')
      return
    }

    onCreate({ baseURL, name: newKeyName.trim() || undefined, apiKey })
    setNewKeyValue('')
    setNewKeyName('')
  }

  const startEditingKey = (key: AiApiKeySummary) => {
    setEditingKeyId(key.id)
    setEditingKeyName(key.name)
    setEditingKeyValue('')
    setShowEditingKeyValue(false)
  }

  const cancelEditing = () => {
    setEditingKeyId(null)
    setEditingKeyName('')
    setEditingKeyValue('')
    setShowEditingKeyValue(false)
  }

  const saveEditingKey = () => {
    if (!editingKeyId) return
    onUpdate({
      id: editingKeyId,
      name: editingKeyName.trim() || undefined,
      apiKey: editingKeyValue.trim() || undefined,
    })
    cancelEditing()
  }

  return (
    <div className="rounded-xl border p-4">
      <div className="mb-3">
        <p className="font-medium">API Key Vault</p>
        <p className="text-sm text-muted-foreground">
          Manage API keys by base URL. Each URL can have multiple keys — one marked as the default.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(180px,1fr)_minmax(220px,1fr)_auto]">
        <InputGroup>
          <InputGroupInput
            value={newKeyBaseURL}
            onChange={(event) => setNewKeyBaseURL(event.target.value)}
            placeholder="Base URL"
            list="provider-base-url-options"
          />
        </InputGroup>
        <Input
          value={newKeyName}
          onChange={(event) => setNewKeyName(event.target.value)}
          placeholder="Key name (optional)"
        />
        <InputGroup>
          <InputGroupInput
            type={showNewKeyValue ? 'text' : 'password'}
            value={newKeyValue}
            onChange={(event) => setNewKeyValue(event.target.value)}
            placeholder="API key"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label={showNewKeyValue ? 'Hide API key' : 'Show API key'}
              onClick={() => setShowNewKeyValue((v) => !v)}
            >
              {showNewKeyValue ? <EyeOff /> : <Eye />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <Button type="button" onClick={createApiKey} disabled={isCreating}>
          <Plus data-icon="inline-start" />
          Add key
        </Button>
      </div>

      <datalist id="provider-base-url-options">
        {suggestedBaseURLs.map((baseURL) => (
          <option key={baseURL} value={baseURL} />
        ))}
      </datalist>

      <div className="mt-4 grid gap-2">
        {apiKeys.length === 0 && (
          <p className="text-sm text-muted-foreground py-3 text-center">
            No API keys stored yet. Add one above to get started.
          </p>
        )}

        {apiKeys.map((apiKey) => {
          const isEditing = editingKeyId === apiKey.id

          return (
            <div key={apiKey.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium truncate">{apiKey.name || 'Unnamed key'}</p>
                  <p className="text-xs text-muted-foreground">
                    <code>{apiKey.baseURL}</code> · {apiKey.maskedKey}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {apiKey.isDefault ? (
                    <Badge variant="secondary">Default</Badge>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onUpdate({ id: apiKey.id, isDefault: true })}
                      disabled={isUpdating}
                    >
                      Set default
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (isEditing) {
                        cancelEditing()
                        return
                      }
                      startEditingKey(apiKey)
                    }}
                  >
                    {isEditing ? 'Cancel' : 'Edit'}
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button type="button" variant="outline" size="sm" disabled={isDeleting} />
                      }
                    >
                      <Trash2 data-icon="inline-start" />
                      Delete
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete API key?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently remove the key{' '}
                          <strong>{apiKey.name || apiKey.maskedKey}</strong>. Providers using this
                          key will fall back to the default key for their base URL.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => onDelete(apiKey.id)}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>

              {isEditing && (
                <div className="mt-3 grid gap-3 md:grid-cols-[minmax(180px,1fr)_minmax(220px,1fr)_auto_auto]">
                  <Input
                    value={editingKeyName}
                    onChange={(event) => setEditingKeyName(event.target.value)}
                    placeholder="Key name"
                  />
                  <Input
                    type={showEditingKeyValue ? 'text' : 'password'}
                    value={editingKeyValue}
                    onChange={(event) => setEditingKeyValue(event.target.value)}
                    placeholder="New key value (leave empty to keep current)"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowEditingKeyValue((v) => !v)}
                  >
                    {showEditingKeyValue ? (
                      <EyeOff data-icon="inline-start" />
                    ) : (
                      <Eye data-icon="inline-start" />
                    )}
                    {showEditingKeyValue ? 'Hide' : 'Show'}
                  </Button>
                  <Button type="button" onClick={saveEditingKey} disabled={isUpdating}>
                    Save key
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
