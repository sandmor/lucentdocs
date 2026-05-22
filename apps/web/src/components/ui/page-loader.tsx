import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PageLoaderProps {
  message?: string
  variant?: 'fullscreen' | 'inline' | 'overlay'
  className?: string
}

function PageLoader({ message, variant = 'fullscreen', className }: PageLoaderProps) {
  const isFullscreen = variant === 'fullscreen'
  const isOverlay = variant === 'overlay'

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-3',
        isFullscreen && 'min-h-screen',
        isOverlay && 'absolute inset-0 bg-background/80 backdrop-blur-sm z-50',
        !isFullscreen && !isOverlay && 'py-12',
        'page-enter-animated',
        className
      )}
    >
      <Loader2 className="text-muted-foreground size-8 animate-spin" aria-hidden="true" />
      {message ? <p className="text-muted-foreground text-sm font-serif">{message}</p> : null}
      <span className="sr-only">Loading</span>
    </div>
  )
}

export { PageLoader }
