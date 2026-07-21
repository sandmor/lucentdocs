import { useState } from 'react'
import type { AssistantMode, AssistantPreferenceOverrides, AssistantPreferences } from '@lucentdocs/shared'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const labels: Record<AssistantMode, string> = { ask: 'Ask — read-only', agent: 'Agent — may edit' }

export function AssistantSettingsForm({ direct, resolved, allowInherit, onSave, isSaving = false }: {
  direct: AssistantPreferenceOverrides
  resolved: AssistantPreferences
  allowInherit: boolean
  onSave: (value: AssistantPreferenceOverrides) => void
  isSaving?: boolean
}) {
  const [mode, setMode] = useState<AssistantMode | 'inherit'>(direct.defaultMode ?? 'inherit')
  const output = (): AssistantPreferenceOverrides => mode === 'inherit' ? {} : { defaultMode: mode }
  const dirty = JSON.stringify(output()) !== JSON.stringify(direct)
  return <div className="space-y-4">
    <Field>
      <FieldLabel htmlFor="assistant-default-mode">Default mode for new chats</FieldLabel>
      <FieldContent>
        <Select value={mode} onValueChange={(value) => setMode(value as AssistantMode | 'inherit')}>
          <SelectTrigger id="assistant-default-mode"><SelectValue /></SelectTrigger>
          <SelectContent>
            {allowInherit && <SelectItem value="inherit">Inherit ({labels[resolved.defaultMode]})</SelectItem>}
            <SelectItem value="ask">{labels.ask}</SelectItem>
            <SelectItem value="agent">{labels.agent}</SelectItem>
          </SelectContent>
        </Select>
      </FieldContent>
    </Field>
    <p className="text-muted-foreground text-xs">This is a default only. Existing project conversations keep their selected mode.</p>
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" disabled={!dirty || isSaving} onClick={() => setMode(direct.defaultMode ?? 'inherit')}>Reset</Button>
      <Button type="button" disabled={!dirty || isSaving} onClick={() => onSave(output())}>{isSaving ? 'Saving…' : 'Save assistant default'}</Button>
    </div>
  </div>
}
