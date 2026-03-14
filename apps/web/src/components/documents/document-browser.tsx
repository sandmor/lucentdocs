import { DndContext, closestCenter } from '@dnd-kit/core'
import { Loader2 } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'
import { BrowserDialogs } from './browser/dialogs'
import { BrowserHeader } from './browser/header'
import { useDocumentBrowser } from './browser/use-document-browser'
import type { DocumentBrowserProps } from './browser/types'
import { SearchResultsList } from './browser/search-results'

export function DocumentBrowser(props: DocumentBrowserProps) {
  const browser = useDocumentBrowser(props)

  return (
    <DndContext
      sensors={browser.sensors}
      collisionDetection={closestCenter}
      onDragEnd={browser.handleDragEnd}
    >
      <section className="bg-muted/15 flex h-full w-full flex-col">
        <BrowserHeader
          breadcrumbs={browser.breadcrumbs}
          onGoToCrumb={browser.goToCrumb}
          onCreateDirectory={() => browser.setCreateDirectoryOpen(true)}
          onCreateDocument={() => browser.setCreateDocumentOpen(true)}
          onImportDocument={browser.handleImportDocument}
          isImporting={browser.isImporting}
          rootDropRef={browser.setRootDropRef}
          isOverRoot={browser.isOverRoot}
          searchQuery={browser.searchQuery}
          onSearchQueryChange={browser.setSearchQuery}
          onClearSearch={browser.clearSearch}
          isSearchActive={browser.isSearchActive}
          isSearchLoading={browser.isSearchLoading}
          searchResultCount={browser.searchResultCount}
        />

        <div className="flex-1 overflow-y-auto p-3">
          {browser.isLoading && !browser.isSearchActive ? (
            <div className="text-muted-foreground flex h-24 items-center justify-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Loading documents...
            </div>
          ) : browser.isSearchActive ? (
            <SearchResultsList
              results={browser.rows}
              query={browser.searchQuery}
              activeDocumentId={props.activeDocumentId}
              emptyMessage={browser.emptyMessage}
              onOpenDocument={props.onOpenDocument}
            />
          ) : (
            <DataTable
              columns={browser.columns}
              data={browser.rows}
              emptyMessage={browser.emptyMessage}
              onRowClick={browser.handleRowClick}
            />
          )}
        </div>

        <BrowserDialogs
          currentPath={browser.currentPath}
          isBusy={browser.isBusy}
          importDialogOpen={browser.importDialogOpen}
          onImportDialogOpenChange={browser.setImportDialogOpen}
          importDraftFileName={browser.importDraftFileName}
          importSplitMode={browser.importSplitMode}
          onImportSplitModeChange={browser.setImportSplitMode}
          importHeadingLevel={browser.importHeadingLevel}
          onImportHeadingLevelChange={browser.setImportHeadingLevel}
          importTargetChars={browser.importTargetChars}
          onImportTargetCharsChange={browser.setImportTargetChars}
          importHtmlMode={browser.importHtmlMode}
          onImportHtmlModeChange={browser.setImportHtmlMode}
          importIncludeContents={browser.importIncludeContents}
          onImportIncludeContentsChange={browser.setImportIncludeContents}
          importProgress={browser.importProgress}
          onConfirmImportDraft={browser.confirmImportDraft}
          onCancelImportDraft={browser.cancelImportDraft}
          createDocumentOpen={browser.createDocumentOpen}
          onCreateDocumentOpenChange={browser.setCreateDocumentOpen}
          newDocumentName={browser.newDocumentName}
          onNewDocumentNameChange={browser.setNewDocumentName}
          onCreateDocument={browser.handleCreateDocument}
          isCreatingDocument={browser.isCreatingDocument}
          createDirectoryOpen={browser.createDirectoryOpen}
          onCreateDirectoryOpenChange={browser.setCreateDirectoryOpen}
          newDirectoryName={browser.newDirectoryName}
          onNewDirectoryNameChange={browser.setNewDirectoryName}
          onCreateDirectory={browser.handleCreateDirectory}
          isCreatingDirectory={browser.isCreatingDirectory}
          renameTarget={browser.renameTarget}
          onRenameTargetChange={browser.setRenameTarget}
          renameName={browser.renameName}
          onRenameNameChange={browser.setRenameName}
          onRename={browser.handleRename}
          renameDescription={browser.renameDescription}
          isRenaming={browser.isRenaming}
          moveTarget={browser.moveTarget}
          onMoveTargetChange={browser.setMoveTarget}
          moveDestination={browser.moveDestination}
          onMoveDestinationChange={browser.setMoveDestination}
          onMove={browser.handleMove}
          isMoving={browser.isMoving}
          deleteTarget={browser.deleteTarget}
          onDeleteTargetChange={browser.setDeleteTarget}
          deleteDescription={browser.deleteDescription}
          onConfirmDelete={browser.handleConfirmDelete}
          isDeleting={browser.isDeleting}
          documentSettingsOpen={browser.settingsDocumentId !== null}
          onDocumentSettingsOpenChange={(open) => !open && browser.setSettingsDocumentId(null)}
          documentSettingsTitle={browser.settingsDocumentTitle}
          documentSettingsDirectStrategy={browser.documentSettings?.document?.strategy ?? null}
          documentSettingsResolvedStrategy={browser.documentSettings?.resolved.strategy ?? null}
          documentSettingsResolvedScopeType={browser.documentSettings?.resolved.scopeType ?? null}
          onSaveDocumentSettings={browser.saveDocumentSettings}
          isLoadingDocumentSettings={browser.isLoadingDocumentSettings}
          isSavingDocumentSettings={browser.isSavingDocumentSettings}
        />
      </section>
    </DndContext>
  )
}
