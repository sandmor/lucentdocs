import { FolderOpen, MessageCircle, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export type SidebarPanel = 'explorer' | 'chat' | 'project-settings'

interface SidebarIconBarProps {
  activePanel: SidebarPanel
  onPanelChange: (panel: SidebarPanel) => void
  isSidebarOpen: boolean
  onToggleSidebar: () => void
}

const panels: {
  id: SidebarPanel
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { id: 'explorer', label: 'Explorer', icon: FolderOpen },
  { id: 'chat', label: 'AI Chat', icon: MessageCircle },
  { id: 'project-settings', label: 'Project Settings', icon: Settings2 },
]

export function SidebarIconBar({
  activePanel,
  onPanelChange,
  isSidebarOpen,
  onToggleSidebar,
}: SidebarIconBarProps) {
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-border/50 bg-muted/10 py-3">
      {panels.map(({ id, label, icon: Icon }) => {
        const isActive = isSidebarOpen && activePanel === id

        return (
          <Tooltip key={id}>
            <TooltipTrigger
              aria-label={label}
              data-sidebar-panel={id}
              className={cn(
                'relative flex size-9 cursor-pointer items-center justify-center rounded-lg transition-all duration-200',
                'hover:bg-muted/40 hover:text-foreground/90',
                isActive ? 'bg-muted/50 text-foreground' : 'text-muted-foreground/50'
              )}
              onClick={() => {
                if (isActive) {
                  onToggleSidebar()
                } else {
                  onPanelChange(id)
                  if (!isSidebarOpen) {
                    onToggleSidebar()
                  }
                }
              }}
            >
              <div
                className={cn(
                  'absolute left-0 top-1/2 w-0.5 -translate-y-1/2 rounded-r-full transition-all duration-300',
                  isActive ? 'h-3.5 bg-foreground/30' : 'h-0 bg-transparent'
                )}
              />

              <Icon
                className={cn(
                  'size-4.5 transition-transform duration-200',
                  isActive && 'scale-[1.05]'
                )}
              />
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {label}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
