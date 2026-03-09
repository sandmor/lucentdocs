import { useRef, type RefCallback } from 'react'
import { ChevronRight, FilePlus, FolderPlus, Info, Loader2, Search, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface BrowserHeaderProps {
  breadcrumbs: string[]
  onGoToCrumb: (index: number) => void
  onCreateDirectory: () => void
  onCreateDocument: () => void
  onImportDocument: (file: File) => void
  isImporting: boolean
  rootDropRef: RefCallback<HTMLSpanElement>
  isOverRoot: boolean
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  onClearSearch: () => void
  isSearchActive: boolean
  isSearchLoading: boolean
  searchResultCount: number
}

export function BrowserHeader({
  breadcrumbs,
  onGoToCrumb,
  onCreateDirectory,
  onCreateDocument,
  onImportDocument,
  isImporting,
  rootDropRef,
  isOverRoot,
  searchQuery,
  onSearchQueryChange,
  onClearSearch,
  isSearchActive,
  isSearchLoading,
  searchResultCount,
}: BrowserHeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      onImportDocument(file)
      event.target.value = ''
    }
  }

  return (
    <header className="border-b px-3 py-2">
      {/* Title row: label + action buttons */}
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-semibold flex-1 truncate">Documents</h2>

        <input
          ref={fileInputRef}
          type="file"
          accept=".md"
          onChange={handleFileChange}
          className="hidden"
        />

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={handleImportClick}
                disabled={isImporting}
                aria-label="Import markdown document"
              />
            }
          >
            <Upload className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="bottom">Import .md file</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={onCreateDirectory}
                aria-label="Create folder"
              />
            }
          >
            <FolderPlus className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="bottom">New folder</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={onCreateDocument}
                aria-label="Create document"
              />
            }
          >
            <FilePlus className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="bottom">New document</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            className="text-muted-foreground/50 hover:text-muted-foreground ml-0.5 flex size-4 cursor-default items-center justify-center"
            aria-label="Drop hint"
          >
            <Info className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-48">
            Drag files or folders onto a folder (or root) to move them.
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="mt-2">
        <label className="sr-only" htmlFor="document-browser-search">
          Search project documents
        </label>
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <Input
            id="document-browser-search"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="Search linked documents semantically"
            className="h-9 rounded-xl border-border/70 bg-background pl-9 pr-20 text-sm shadow-none"
            data-document-search="true"
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {isSearchLoading ? (
              <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
            ) : null}
            {searchQuery ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={onClearSearch}
                aria-label="Clear document search"
              >
                <X className="size-4" />
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {isSearchActive ? (
        <div className="text-muted-foreground mt-1.5 flex items-center justify-between gap-3 text-xs">
          <span className="truncate">Searching all documents linked to this project</span>
          <span className="shrink-0">
            {searchResultCount} result{searchResultCount === 1 ? '' : 's'}
          </span>
        </div>
      ) : (
        <div className="text-muted-foreground mt-1.5 flex min-w-0 items-center gap-0.5 overflow-x-auto text-xs">
          <span
            ref={rootDropRef}
            className={cn(
              'shrink-0 rounded px-1 py-0.5',
              isOverRoot && 'bg-accent text-accent-foreground'
            )}
          >
            <button className="hover:text-foreground" onClick={() => onGoToCrumb(-1)}>
              root
            </button>
          </span>
          {breadcrumbs.map((crumb, index) => (
            <span key={`${crumb}-${index}`} className="flex shrink-0 items-center gap-0.5">
              <ChevronRight className="size-3 shrink-0" />
              <button
                className="hover:text-foreground max-w-25 truncate"
                onClick={() => onGoToCrumb(index)}
              >
                {crumb}
              </button>
            </span>
          ))}
        </div>
      )}
    </header>
  )
}
