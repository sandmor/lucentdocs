import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Kbd } from '@/components/ui/kbd'
import { Sparkles, ArrowRight, Loader2 } from 'lucide-react'

interface AiPanelProps {
  onContinue: () => void
  onGenerate: (prompt: string) => void
  isGenerating: boolean
  includeAfterContext: boolean
  onIncludeAfterContextChange: (value: boolean) => void
}

export function AiPanel({
  onContinue,
  onGenerate,
  isGenerating,
  includeAfterContext,
  onIncludeAfterContextChange,
}: AiPanelProps) {
  const [prompt, setPrompt] = useState('')

  const handleGenerate = () => {
    if (!prompt.trim() || isGenerating) return
    onGenerate(prompt.trim())
    setPrompt('')
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="text-primary size-5" />
        <h2 className="text-sm font-semibold">AI Assistant</h2>
      </div>

      <Separator />

      <Button
        variant="outline"
        className="justify-start"
        onClick={onContinue}
        disabled={isGenerating}
      >
        {isGenerating ? (
          <Loader2 className="animate-spin" data-icon="inline-start" />
        ) : (
          <ArrowRight data-icon="inline-start" />
        )}
        Continue writing
      </Button>

      <div className="flex items-center gap-2">
        <Switch
          id="include-after"
          checked={includeAfterContext}
          onCheckedChange={onIncludeAfterContextChange}
          disabled={isGenerating}
        />
        <label htmlFor="include-after" className="text-xs">
          Include text after cursor
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-muted-foreground text-xs font-medium">
          Or describe what you need...
        </label>
        <Textarea
          placeholder="e.g. Write a tense dialogue between the protagonist and the antagonist..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-h-24 text-sm"
          disabled={isGenerating}
        />
        <Button size="sm" onClick={handleGenerate} disabled={!prompt.trim() || isGenerating}>
          {isGenerating ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : (
            <Sparkles data-icon="inline-start" />
          )}
          Generate
        </Button>
      </div>

      {isGenerating && (
        <div className="text-muted-foreground rounded-lg border bg-muted/50 p-3 text-xs">
          Generating... Use <Kbd>Tab</Kbd> to accept or <Kbd>Esc</Kbd> to reject.
        </div>
      )}
    </div>
  )
}
