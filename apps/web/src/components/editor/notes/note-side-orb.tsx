import { MessageSquareText } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NoteSideOrbProps {
  count?: number
  onClick: () => void
  className?: string
  title?: string
}

export function NoteSideOrb({ count, onClick, className, title }: NoteSideOrbProps) {
  return (
    <button
      type="button"
      title={title}
      className={cn(
        'flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background/95 shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur-md transition-colors hover:bg-muted/50 dark:shadow-black/40 dark:ring-white/10',
        className
      )}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
    >
      {count && count > 1 ? (
        <span className="text-xs font-bold text-primary">{count}</span>
      ) : (
        <MessageSquareText className="size-4 text-muted-foreground" />
      )}
    </button>
  )
}
