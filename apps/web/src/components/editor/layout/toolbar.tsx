import { ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

interface EditorToolbarProps {
  isGenerating: boolean
  includeAfterContext: boolean
  onToggleIncludeAfterContext: (value: boolean) => void
  onContinueWriting: () => void
}

export function EditorToolbar({
  isGenerating,
  includeAfterContext,
  onToggleIncludeAfterContext,
  onContinueWriting,
}: EditorToolbarProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border/80 bg-card/60 px-3 py-2 backdrop-blur">
      <Button variant="outline" size="sm" onClick={onContinueWriting} disabled={isGenerating}>
        {isGenerating ? (
          <Loader2 className="animate-spin" data-icon="inline-start" />
        ) : (
          <ArrowRight data-icon="inline-start" />
        )}
        Continue writing
      </Button>

      <div className="ml-auto flex items-center gap-2">
        <Switch
          id="include-after-context"
          checked={includeAfterContext}
          onCheckedChange={(value) => onToggleIncludeAfterContext(Boolean(value))}
          disabled={isGenerating}
        />
        <label htmlFor="include-after-context" className="text-xs text-muted-foreground">
          Include text after cursor
        </label>
      </div>
    </div>
  )
}
