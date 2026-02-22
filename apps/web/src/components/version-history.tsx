import { useState } from 'react'
import {
  Combobox,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from '@/components/ui/combobox'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { History, Loader2, Save } from 'lucide-react'

export interface VersionSnapshotInfo {
  id: string
  documentId: string
  createdAt: number
}

interface VersionHistoryProps {
  versions: VersionSnapshotInfo[]
  onRestore: (snapshotId: string) => void
  onCreateSnapshot: () => void
  isRestoring?: boolean
  isCreatingSnapshot?: boolean
}

function formatVersionDate(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export function VersionHistory({
  versions,
  onRestore,
  onCreateSnapshot,
  isRestoring = false,
  isCreatingSnapshot = false,
}: VersionHistoryProps) {
  const [open, setOpen] = useState(false)

  const sortedVersions = [...versions].sort((a, b) => b.createdAt - a.createdAt)
  const latestVersion = sortedVersions[0]

  const handleSelect = (value: string | null) => {
    if (!value) return
    if (value === '__create__') {
      onCreateSnapshot()
      setOpen(false)
      return
    }
    onRestore(value)
    setOpen(false)
  }

  return (
    <div className="flex items-center gap-1">
      <Combobox
        open={open}
        onOpenChange={setOpen}
        value={latestVersion?.id ?? ''}
        onValueChange={handleSelect}
      >
        <ComboboxTrigger
          render={<Button variant="ghost" size="sm" disabled={isRestoring || isCreatingSnapshot} />}
        >
          {isRestoring || isCreatingSnapshot ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <History className="size-4" />
          )}
          <span className="ml-1">{sortedVersions.length} snapshots</span>
        </ComboboxTrigger>
        <ComboboxContent>
          <ComboboxList>
            <ComboboxEmpty>No snapshots</ComboboxEmpty>
            <ComboboxItem value="__create__">
              <span className="flex items-center gap-2 text-primary">
                <Save className="size-3" />
                <span>Create snapshot</span>
              </span>
            </ComboboxItem>
            {sortedVersions.map((v, index) => (
              <ComboboxItem key={v.id} value={v.id}>
                <span className="flex items-center gap-2">
                  <span>#{sortedVersions.length - index}</span>
                  <span className="text-muted-foreground text-xs">
                    {formatVersionDate(v.createdAt)}
                  </span>
                  {index === 0 && (
                    <Badge variant="secondary" className="text-xs">
                      latest
                    </Badge>
                  )}
                </span>
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  )
}
