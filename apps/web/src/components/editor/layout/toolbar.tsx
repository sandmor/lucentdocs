import { ArrowRight, Loader2 } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface EditorToolbarProps {
  isGenerating: boolean
  onContinueWriting: () => void
  titleInput: string
  onTitleChange: (value: string) => void
  onTitleBlur: () => void
  onTitleKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  titleDisabled: boolean
}

export function EditorToolbar({
  isGenerating,
  onContinueWriting,
  titleInput,
  onTitleChange,
  onTitleBlur,
  onTitleKeyDown,
  titleDisabled,
}: EditorToolbarProps) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-border/80 bg-card/60 px-3 py-2 backdrop-blur">
      <Input
        value={titleInput}
        onChange={(e) => onTitleChange(e.target.value)}
        onBlur={onTitleBlur}
        onKeyDown={onTitleKeyDown}
        autoComplete="off"
        disabled={titleDisabled}
        className="flex-1 min-w-0 max-w-45 sm:max-w-xs border-none bg-transparent text-sm sm:text-base font-semibold shadow-none focus-visible:ring-0"
      />

      <Button
        variant="outline"
        size="icon-sm"
        onClick={onContinueWriting}
        disabled={isGenerating}
        className="shrink-0 sm:w-auto sm:px-3"
      >
        {isGenerating ? (
          <Loader2 className="animate-spin" data-icon="inline-start" />
        ) : (
          <ArrowRight data-icon="inline-start" />
        )}
        <span className="hidden sm:inline">Continue writing</span>
      </Button>
    </div>
  )
}
