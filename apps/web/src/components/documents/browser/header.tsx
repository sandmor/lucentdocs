import type { RefCallback } from 'react'
import { ChevronRight, FilePlus, FolderPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface BrowserHeaderProps {
  breadcrumbs: string[]
  onGoToCrumb: (index: number) => void
  onCreateDirectory: () => void
  onCreateDocument: () => void
  rootDropRef: RefCallback<HTMLSpanElement>
  isOverRoot: boolean
}

export function BrowserHeader({
  breadcrumbs,
  onGoToCrumb,
  onCreateDirectory,
  onCreateDocument,
  rootDropRef,
  isOverRoot,
}: BrowserHeaderProps) {
  return (
    <header className="border-b px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Documents</h2>
          <div className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
            <span
              ref={rootDropRef}
              className={cn('rounded px-1 py-0.5', isOverRoot && 'bg-accent text-accent-foreground')}
            >
              <button className="hover:text-foreground" onClick={() => onGoToCrumb(-1)}>
                root
              </button>
            </span>
            {breadcrumbs.map((crumb, index) => (
              <span key={`${crumb}-${index}`} className="flex items-center gap-1">
                <ChevronRight className="size-3" />
                <button className="hover:text-foreground truncate" onClick={() => onGoToCrumb(index)}>
                  {crumb}
                </button>
              </span>
            ))}
          </div>
          <p className="text-muted-foreground mt-1 text-[11px]">
            Drag files or folders onto a folder (or root) to move.
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={onCreateDirectory}>
            <FolderPlus data-icon="inline-start" />
            Folder
          </Button>
          <Button size="sm" onClick={onCreateDocument}>
            <FilePlus data-icon="inline-start" />
            File
          </Button>
        </div>
      </div>
    </header>
  )
}
