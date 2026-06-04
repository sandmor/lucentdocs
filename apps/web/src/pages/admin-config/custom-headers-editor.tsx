import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

type HeaderRow = {
  id: string
  key: string
  value: string
}

function headersToRows(headers: Record<string, string>): HeaderRow[] {
  const entries = Object.entries(headers)
  if (entries.length === 0) {
    return [{ id: 'row-0', key: '', value: '' }]
  }

  return entries.map(([key, value], index) => ({
    id: `row-${index}-${key}`,
    key,
    value,
  }))
}

function rowsToHeaders(rows: HeaderRow[]): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) continue
    headers[key] = row.value.trim()
  }
  return headers
}

interface CustomHeadersEditorProps {
  providerId: string
  headers: Record<string, string>
  onChange: (headers: Record<string, string>) => void
}

export function CustomHeadersEditor({ providerId, headers, onChange }: CustomHeadersEditorProps) {
  const rows = headersToRows(headers)

  const updateRows = (nextRows: HeaderRow[]) => {
    onChange(rowsToHeaders(nextRows))
  }

  return (
    <Field className="sm:col-span-2">
      <FieldLabel htmlFor={`provider-custom-headers-${providerId}`}>Custom HTTP headers</FieldLabel>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={row.id} className="flex items-start gap-2">
            <Input
              value={row.key}
              onChange={(event) => {
                const nextRows = rows.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, key: event.target.value } : item
                )
                updateRows(nextRows)
              }}
              placeholder="Header name"
              autoComplete="off"
              className="min-w-0 flex-1"
            />
            <Input
              value={row.value}
              onChange={(event) => {
                const nextRows = rows.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, value: event.target.value } : item
                )
                updateRows(nextRows)
              }}
              placeholder="Header value"
              autoComplete="off"
              className="min-w-0 flex-[1.5]"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={rows.length <= 1 && !row.key && !row.value}
              onClick={() => {
                const nextRows = rows.filter((_, itemIndex) => itemIndex !== index)
                updateRows(
                  nextRows.length > 0 ? nextRows : [{ id: `row-${Date.now()}`, key: '', value: '' }]
                )
              }}
              title="Remove header"
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <FieldDescription>
          Optional headers sent with every request to this provider. Built-in auth headers take
          precedence on conflicts.
        </FieldDescription>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            updateRows([...rows, { id: `row-${Date.now()}`, key: '', value: '' }])
          }}
        >
          <Plus />
          Add header
        </Button>
      </div>
    </Field>
  )
}
