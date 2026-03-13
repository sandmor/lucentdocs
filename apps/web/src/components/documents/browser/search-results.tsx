import { FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { HighlightedSnippet } from './row-cells'
import type { BrowserRow } from './types'

interface SearchResultsListProps {
  results: BrowserRow[]
  query: string
  activeDocumentId: string
  emptyMessage?: string
  onOpenDocument: (documentId: string, range?: { start: number; end: number }) => void
}

function toMatchPercent(score: number): number {
  return Math.max(1, Math.min(99, Math.round((1 - score) * 100)))
}

export function SearchResultsList({
  results,
  query,
  activeDocumentId,
  emptyMessage = 'No semantic matches found in this project.',
  onOpenDocument,
}: SearchResultsListProps) {
  const items = results.filter((result) => result.type === 'search-result')

  if (items.length === 0) {
    return (
      <div className="text-muted-foreground flex h-24 items-center justify-center text-sm">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-12">
      {items.map((result) => {
        const isActive = result.id === activeDocumentId
        const hitCount = result.snippets.length

        return (
          <div
            key={result.key}
            data-search-result-card={result.id}
            className={cn(
              'group relative rounded-lg border p-3 transition-colors',
              isActive
                ? 'bg-accent/50 border-accent'
                : 'bg-card border-transparent hover:bg-accent/20 hover:border-border/50'
            )}
          >
            <div className="flex items-start gap-3">
              <div className="mt-1 shrink-0 text-muted-foreground">
                <FileText className="size-4" />
              </div>

              <div className="min-w-0 flex-1 space-y-2">
                <button onClick={() => onOpenDocument(result.id)} className="w-full text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn('truncate text-sm font-medium', isActive && 'text-foreground')}
                    >
                      {result.name}
                    </span>
                    {result.matchType === 'whole_document' ? (
                      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                        {toMatchPercent(result.score)}% match
                      </span>
                    ) : hitCount > 0 ? (
                      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                        {hitCount} hit{hitCount === 1 ? '' : 's'}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{result.path}</div>
                </button>

                {result.matchType === 'whole_document' ? (
                  <div className="rounded-md border border-dashed border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    Whole document match. Open the document to review it in context.
                  </div>
                ) : result.snippets.length > 0 ? (
                  <div className="space-y-2 pt-1">
                    {result.snippets.map((snippet, index) => (
                      <button
                        key={`${snippet.score}-${index}`}
                        data-search-result-snippet={`${result.id}:${index}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenDocument(result.id, {
                            start: snippet.selectionFrom,
                            end: snippet.selectionTo,
                          })
                        }}
                        className="w-full text-left group/snippet"
                      >
                        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground transition-colors group-hover/snippet:bg-muted group-hover/snippet:text-foreground">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">
                              Match
                            </span>
                            <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground/90">
                              {toMatchPercent(snippet.score)}%
                            </span>
                          </div>
                          <HighlightedSnippet text={snippet.text} query={query} />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
