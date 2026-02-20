import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Sparkles, ArrowRight, Loader2 } from 'lucide-react'

interface AiPanelProps {
  /** Callback to get the current document text for context */
  getContext: () => string
  /** Callback to insert AI-generated text into the editor */
  onInsert: (text: string) => void
}

export function AiPanel({ getContext, onInsert }: AiPanelProps) {
  const [prompt, setPrompt] = useState('')
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  async function runStream(payload: {
    mode: 'continue' | 'prompt'
    context: string
    prompt?: string
    hint?: string
  }) {
    abortRef.current?.abort()
    const abortController = new AbortController()
    abortRef.current = abortController

    setError(null)
    setIsPending(true)
    setLastResult('')

    try {
      const response = await fetch('/api/ai/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || 'AI request failed')
      }

      if (!response.body) {
        throw new Error('No stream returned from AI endpoint')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let text = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          text += decoder.decode(value, { stream: true })
          setLastResult(text)
        }
      }

      text += decoder.decode()
      setLastResult(text)
    } catch (streamError: unknown) {
      if (streamError instanceof Error && streamError.name === 'AbortError') return
      const message =
        streamError instanceof Error ? streamError.message : 'Failed to stream AI text'
      setError(message)
    } finally {
      setIsPending(false)
      if (abortRef.current === abortController) {
        abortRef.current = null
      }
    }
  }

  const handleContinue = () => {
    const context = getContext()
    void runStream({ mode: 'continue', context })
  }

  const handlePrompt = () => {
    if (!prompt.trim()) return
    const context = getContext()
    void runStream({ mode: 'prompt', context, prompt: prompt.trim() })
  }

  const handleInsert = () => {
    if (lastResult) {
      onInsert(lastResult)
      setLastResult(null)
    }
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
        onClick={handleContinue}
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="animate-spin" data-icon="inline-start" />
        ) : (
          <ArrowRight data-icon="inline-start" />
        )}
        Continue writing
      </Button>

      <div className="flex flex-col gap-2">
        <label className="text-muted-foreground text-xs font-medium">
          Or describe what you need…
        </label>
        <Textarea
          placeholder="e.g. Write a tense dialogue between the protagonist and the antagonist…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-h-24 text-sm"
        />
        <Button size="sm" onClick={handlePrompt} disabled={!prompt.trim() || isPending}>
          {isPending ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : (
            <Sparkles data-icon="inline-start" />
          )}
          Generate
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {lastResult && (
        <>
          <Separator />
          <div className="flex flex-col gap-2">
            <label className="text-muted-foreground text-xs font-medium">Preview</label>
            <div className="bg-muted max-h-64 overflow-y-auto rounded-lg p-3 text-sm leading-relaxed whitespace-pre-wrap">
              {lastResult}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleInsert}>
                Insert into document
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setLastResult(null)}>
                Discard
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
