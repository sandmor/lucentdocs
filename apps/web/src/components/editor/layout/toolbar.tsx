import { ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface EditorToolbarProps {
  isGenerating: boolean
  onContinueWriting: () => void
}

export function EditorToolbar({ isGenerating, onContinueWriting }: EditorToolbarProps) {
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
    </div>
  )
}
