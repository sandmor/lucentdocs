import * as React from 'react'
import { Check, Copy } from 'lucide-react'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@/components/ui/combobox'
import { Button } from '@/components/ui/button'
import {
  formatLanguageName,
  getLanguagePickerOptions,
  toCanonicalStoredLanguage,
  toPickerValue,
  toStoredLanguage,
} from './code-block-languages'

export function CodeBlockLanguageSelector({
  value,
  onChange,
}: {
  value: string
  onChange: (val: string) => void
}) {
  const [anchor, setAnchor] = React.useState<HTMLButtonElement | null>(null)
  const options = React.useMemo(() => getLanguagePickerOptions(value), [value])
  const items = React.useMemo(() => options.map((option) => option.value), [options])
  const selectedValue = toPickerValue(value)

  const selectedLabel = React.useMemo(() => {
    const option = options.find((item) => item.value === selectedValue)
    if (option) return option.label
    return formatLanguageName(selectedValue)
  }, [options, selectedValue])

  return (
    <Combobox
      items={items}
      itemToStringLabel={(item) => {
        const option = options.find((entry) => entry.value === item)
        return option?.label ?? formatLanguageName(item)
      }}
      itemToStringValue={(item) => item}
      value={selectedValue}
      onValueChange={(nextValue) => {
        if (!nextValue) {
          onChange('')
          return
        }
        onChange(toStoredLanguage(toCanonicalStoredLanguage(nextValue)))
      }}
    >
      <ComboboxTrigger
        render={
          <Button
            ref={setAnchor}
            variant="ghost"
            size="sm"
            className="h-7 min-w-32 max-w-48 justify-between border-none bg-transparent px-2 text-xs font-medium tracking-wide text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground"
          />
        }
      >
        <span className="truncate uppercase">{selectedLabel}</span>
      </ComboboxTrigger>
      <ComboboxContent anchor={anchor} align="start" className="min-w-56">
        <ComboboxInput placeholder="Search languages…" showClear />
        <ComboboxEmpty>No languages found.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => {
            const option = options.find((entry) => entry.value === item)
            return (
              <ComboboxItem key={item} value={item}>
                <span className="flex flex-col items-start">
                  <span>{option?.label ?? formatLanguageName(item)}</span>
                  {option?.unsupported ? (
                    <span className="text-muted-foreground text-xs">Unsupported highlighting</span>
                  ) : null}
                </span>
              </ComboboxItem>
            )
          }}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

export function CodeBlockCopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = React.useState(false)

  return (
    <button
      type="button"
      className="code-block-copy-btn"
      title={copied ? 'Copied' : 'Copy code'}
      onClick={() => {
        void navigator.clipboard.writeText(getText()).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 2000)
        })
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  )
}
