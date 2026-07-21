import { useState } from 'react'
import type { EditorPreferenceOverrides, EditorPreferences, QuoteStyle } from '@lucentdocs/shared'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const labels: Record<QuoteStyle, string> = {
  preserve: 'Preserve as typed',
  straight: 'Straight',
  smart: 'Smart',
}

export function TypographySettingsForm({
  direct,
  resolved,
  allowInherit,
  onSave,
  isSaving = false,
}: {
  direct: EditorPreferenceOverrides
  resolved: EditorPreferences
  allowInherit: boolean
  onSave: (value: EditorPreferenceOverrides) => void
  isSaving?: boolean
}) {
  const [single, setSingle] = useState<QuoteStyle | 'inherit'>(direct.singleQuoteStyle ?? 'inherit')
  const [double, setDouble] = useState<QuoteStyle | 'inherit'>(direct.doubleQuoteStyle ?? 'inherit')
  const output = (): EditorPreferenceOverrides => ({
    ...(single !== 'inherit' ? { singleQuoteStyle: single } : {}),
    ...(double !== 'inherit' ? { doubleQuoteStyle: double } : {}),
  })
  const dirty = JSON.stringify(output()) !== JSON.stringify(direct)
  const items = (value: QuoteStyle) => ({
    ...(allowInherit ? { inherit: `Inherit (${labels[value]})` } : {}),
    preserve: labels.preserve,
    straight: labels.straight,
    smart: labels.smart,
  })
  return (
    <div className="space-y-4">
      <Field>
        <FieldLabel htmlFor="single-quote-style">Single quotes</FieldLabel>
        <FieldContent>
          <Select
            value={single}
            items={items(resolved.singleQuoteStyle)}
            onValueChange={(v) => setSingle(v as QuoteStyle | 'inherit')}
          >
            <SelectTrigger id="single-quote-style">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allowInherit && (
                <SelectItem value="inherit">
                  Inherit ({labels[resolved.singleQuoteStyle]})
                </SelectItem>
              )}
              <SelectItem value="preserve">{labels.preserve}</SelectItem>
              <SelectItem value="straight">Straight</SelectItem>
              <SelectItem value="smart">Smart</SelectItem>
            </SelectContent>
          </Select>
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="double-quote-style">Double quotes</FieldLabel>
        <FieldContent>
          <Select
            value={double}
            items={items(resolved.doubleQuoteStyle)}
            onValueChange={(v) => setDouble(v as QuoteStyle | 'inherit')}
          >
            <SelectTrigger id="double-quote-style">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allowInherit && (
                <SelectItem value="inherit">
                  Inherit ({labels[resolved.doubleQuoteStyle]})
                </SelectItem>
              )}
              <SelectItem value="preserve">{labels.preserve}</SelectItem>
              <SelectItem value="straight">Straight</SelectItem>
              <SelectItem value="smart">Smart</SelectItem>
            </SelectContent>
          </Select>
        </FieldContent>
      </Field>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!dirty || isSaving}
          onClick={() => {
            setSingle(direct.singleQuoteStyle ?? 'inherit')
            setDouble(direct.doubleQuoteStyle ?? 'inherit')
          }}
        >
          Reset
        </Button>
        <Button type="button" disabled={!dirty || isSaving} onClick={() => onSave(output())}>
          {isSaving ? 'Saving…' : 'Save typography'}
        </Button>
      </div>
    </div>
  )
}
