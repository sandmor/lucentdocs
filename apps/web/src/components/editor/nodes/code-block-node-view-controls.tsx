import * as React from 'react'
import { Check, Copy } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const PLAIN_LANGUAGE = 'plain'

const LANGUAGES = [
  { value: PLAIN_LANGUAGE, label: 'Plain Text' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'json', label: 'JSON' },
  { value: 'python', label: 'Python' },
  { value: 'rust', label: 'Rust' },
  { value: 'go', label: 'Go' },
  { value: 'bash', label: 'Bash' },
]

function toSelectLanguage(language: string): string {
  return language || PLAIN_LANGUAGE
}

function fromSelectLanguage(language: string): string {
  return language === PLAIN_LANGUAGE ? '' : language
}

export function CodeBlockLanguageSelector({
  value,
  onChange,
}: {
  value: string
  onChange: (val: string) => void
}) {
  return (
    <Select
      value={toSelectLanguage(value)}
      onValueChange={(val) => onChange(fromSelectLanguage(val ?? PLAIN_LANGUAGE))}
    >
      <SelectTrigger className="h-7 w-32 border-none bg-transparent text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground focus-visible:ring-0 shadow-none px-2">
        <SelectValue placeholder="Language" />
      </SelectTrigger>
      <SelectContent align="start" className="w-40">
        {LANGUAGES.map((lang) => (
          <SelectItem key={lang.value} value={lang.value}>
            {lang.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
