import { useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { DocumentListRow } from './row-cells'
import type { BrowserRow } from './types'

const ROW_HEIGHT = 36

interface DocumentListProps {
  rows: BrowserRow[]
  activeDocumentId: string
  scrollElement: HTMLElement | null
  emptyMessage?: string
  onRowClick: (row: BrowserRow) => void
  onRenameDocument: (documentId: string) => void
  onMoveDocument: (documentId: string) => void
  onSettingsDocument: (documentId: string) => void
  onDeleteDocument: (documentId: string) => void
  onExportDocument: (documentId: string) => void
  onRenameDirectory: (path: string) => void
  onMoveDirectory: (path: string) => void
  onDeleteDirectory: (path: string) => void
}

export function DocumentList({
  rows,
  activeDocumentId,
  scrollElement,
  emptyMessage = 'No documents in this directory.',
  onRowClick,
  onRenameDocument,
  onMoveDocument,
  onSettingsDocument,
  onDeleteDocument,
  onExportDocument,
  onRenameDirectory,
  onMoveDirectory,
  onDeleteDirectory,
}: DocumentListProps) {
  'use no memo'

  // TanStack Virtual returns functions that React Compiler cannot memoize safely.
  // This list is intentionally not compiler-memoized and uses the hook directly.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  useEffect(() => {
    virtualizer.measure()
  }, [scrollElement, rows.length, virtualizer])

  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground flex h-20 items-center justify-center text-sm">
        {emptyMessage}
      </div>
    )
  }

  const virtualRows = virtualizer.getVirtualItems()
  const topPadding = virtualRows.length > 0 ? virtualRows[0].start : 0
  const bottomPadding =
    virtualRows.length > 0
      ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0

  return (
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {topPadding > 0 && <div style={{ height: topPadding }} aria-hidden="true" />}
      {virtualRows.map((virtualRow) => {
        const row = rows[virtualRow.index]
        const isActive = row.type === 'document' && row.id === activeDocumentId

        return (
          <DocumentListRow
            key={row.key}
            row={row}
            isActive={isActive}
            onClick={() => onRowClick(row)}
            onRenameDocument={onRenameDocument}
            onMoveDocument={onMoveDocument}
            onSettingsDocument={onSettingsDocument}
            onDeleteDocument={onDeleteDocument}
            onExportDocument={onExportDocument}
            onRenameDirectory={onRenameDirectory}
            onMoveDirectory={onMoveDirectory}
            onDeleteDirectory={onDeleteDirectory}
          />
        )
      })}
      {bottomPadding > 0 && <div style={{ height: bottomPadding }} aria-hidden="true" />}
    </div>
  )
}
