import { useRef, type RefCallback } from 'react'
import { ChevronRight, FilePlus, FolderPlus, Info, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

      {/* Breadcrumb row */}
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
    </header>
  )
}
