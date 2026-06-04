import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { IndexingStrategy, IndexingStrategyScopeType } from '@lucentdocs/shared'
import { Loader2 } from 'lucide-react'
import { IndexingStrategyForm } from '@/components/indexing/strategy-form'
import { AiModelSelectionForm } from '@/components/ai-model-selection/form'
import type { DeleteTarget, MarkdownRawHtmlMode, MoveTarget, RenameTarget } from './types'

interface BrowserDialogsProps {
  currentPath: string
  isBusy: boolean
  createDocumentOpen: boolean
  onCreateDocumentOpenChange: (open: boolean) => void
  newDocumentName: string
  onNewDocumentNameChange: (value: string) => void
  onCreateDocument: () => void
  isCreatingDocument: boolean
  createDirectoryOpen: boolean
  onCreateDirectoryOpenChange: (open: boolean) => void
  newDirectoryName: string
  onNewDirectoryNameChange: (value: string) => void
  onCreateDirectory: () => void
  isCreatingDirectory: boolean
  renameTarget: RenameTarget | null
  onRenameTargetChange: (target: RenameTarget | null) => void
  renameName: string
  onRenameNameChange: (value: string) => void
  onRename: () => void
  renameDescription: string
  isRenaming: boolean
  moveTarget: MoveTarget | null
  onMoveTargetChange: (target: MoveTarget | null) => void
  moveDestination: string
  onMoveDestinationChange: (value: string) => void
  onMove: () => void
  isMoving: boolean
  deleteTarget: DeleteTarget | null
  onDeleteTargetChange: (target: DeleteTarget | null) => void
  deleteDescription: string
  onConfirmDelete: () => void
  isDeleting: boolean
  documentSettingsOpen: boolean
  onDocumentSettingsOpenChange: (open: boolean) => void
  documentSettingsTitle: string
  documentSettingsDirectStrategy: IndexingStrategy | null
  documentSettingsResolvedStrategy: IndexingStrategy | null
  documentSettingsResolvedScopeType: IndexingStrategyScopeType | null
  onSaveDocumentSettings: (strategy: IndexingStrategy | null) => void
  isLoadingDocumentSettings: boolean
  isSavingDocumentSettings: boolean
  documentAiModelDirectId: string | null
  documentAiModelResolvedId: string | null
  documentAiModelResolvedScopeType: IndexingStrategyScopeType | null
  availableProviders: Array<{ id: string; name: string | null; providerId: string; model: string }>
  onSaveDocumentAiModel: (providerConfigId: string | null) => void
  isLoadingDocumentAiModel: boolean
  isSavingDocumentAiModel: boolean
  documentEmbeddingModelDirectId: string | null
  documentEmbeddingModelResolvedId: string | null
  documentEmbeddingModelResolvedScopeType: IndexingStrategyScopeType | null
  availableEmbeddingProviders: Array<{
    id: string
    name: string | null
    providerId: string
    model: string
  }>
  onSaveDocumentEmbeddingModel: (providerConfigId: string | null) => void
  isLoadingDocumentEmbeddingModel: boolean
  isSavingDocumentEmbeddingModel: boolean

  importDialogOpen: boolean
  onImportDialogOpenChange: (open: boolean) => void
  importDraftFileName: string | null
  importSplitMode: 'heading' | 'size'
  onImportSplitModeChange: (value: 'heading' | 'size') => void
  importHeadingLevel: 1 | 2 | 3
  onImportHeadingLevelChange: (value: 1 | 2 | 3) => void
  importTargetChars: number
  onImportTargetCharsChange: (value: number) => void
  importRawHtmlMode: MarkdownRawHtmlMode
  onImportRawHtmlModeChange: (value: MarkdownRawHtmlMode) => void
  importIncludeContents: boolean
  onImportIncludeContentsChange: (value: boolean) => void
  importProgress: { total: number; imported: number; failed: number; isRunning: boolean }
  onConfirmImportDraft: () => void
  onCancelImportDraft: () => void
}

export function BrowserDialogs({
  currentPath,
  isBusy,
  createDocumentOpen,
  onCreateDocumentOpenChange,
  newDocumentName,
  onNewDocumentNameChange,
  onCreateDocument,
  isCreatingDocument,
  createDirectoryOpen,
  onCreateDirectoryOpenChange,
  newDirectoryName,
  onNewDirectoryNameChange,
  onCreateDirectory,
  isCreatingDirectory,
  renameTarget,
  onRenameTargetChange,
  renameName,
  onRenameNameChange,
  onRename,
  renameDescription,
  isRenaming,
  moveTarget,
  onMoveTargetChange,
  moveDestination,
  onMoveDestinationChange,
  onMove,
  isMoving,
  deleteTarget,
  onDeleteTargetChange,
  deleteDescription,
  onConfirmDelete,
  isDeleting,
  documentSettingsOpen,
  onDocumentSettingsOpenChange,
  documentSettingsTitle,
  documentSettingsDirectStrategy,
  documentSettingsResolvedStrategy,
  documentSettingsResolvedScopeType,
  onSaveDocumentSettings,
  isLoadingDocumentSettings,
  isSavingDocumentSettings,
  documentAiModelDirectId,
  documentAiModelResolvedId,
  documentAiModelResolvedScopeType,
  availableProviders,
  onSaveDocumentAiModel,
  isLoadingDocumentAiModel,
  isSavingDocumentAiModel,
  documentEmbeddingModelDirectId,
  documentEmbeddingModelResolvedId,
  documentEmbeddingModelResolvedScopeType,
  availableEmbeddingProviders,
  onSaveDocumentEmbeddingModel,
  isLoadingDocumentEmbeddingModel,
  isSavingDocumentEmbeddingModel,

  importDialogOpen,
  onImportDialogOpenChange,
  importDraftFileName,
  importSplitMode,
  onImportSplitModeChange,
  importHeadingLevel,
  onImportHeadingLevelChange,
  importTargetChars,
  onImportTargetCharsChange,
  importRawHtmlMode,
  onImportRawHtmlModeChange,
  importIncludeContents,
  onImportIncludeContentsChange,
  importProgress,
  onConfirmImportDraft,
  onCancelImportDraft,
}: BrowserDialogsProps) {
  return (
    <>
      <Dialog open={importDialogOpen} onOpenChange={onImportDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import large markdown file</DialogTitle>
            <DialogDescription>
              {importDraftFileName
                ? `${importDraftFileName} will be split into multiple documents.`
                : 'This file will be split into multiple documents.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 px-1">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Split mode</Label>
              <div className="col-span-3">
                <Select
                  value={importSplitMode === 'size' ? 'size' : String(importHeadingLevel)}
                  items={{
                    '1': 'By H1 (#)',
                    '2': 'By H2 (##)',
                    '3': 'By H3 (###)',
                    size: 'By File Size',
                  }}
                  onValueChange={(value: string | null) => {
                    if (!value) return
                    if (value === 'size') {
                      onImportSplitModeChange('size')
                      return
                    }
                    onImportSplitModeChange('heading')
                    onImportHeadingLevelChange(Number(value) as 1 | 2 | 3)
                  }}
                >
                  <SelectTrigger
                    className="w-full"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <SelectValue placeholder="Split mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">By H1 (#)</SelectItem>
                    <SelectItem value="2">By H2 (##)</SelectItem>
                    <SelectItem value="3">By H3 (###)</SelectItem>
                    <SelectItem value="size">By File Size</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Target characters</Label>
              <div className="col-span-3 space-y-1">
                <Input
                  className="w-full"
                  inputMode="numeric"
                  value={String(importTargetChars)}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    if (!Number.isFinite(next)) return
                    onImportTargetCharsChange(Math.max(1, Math.floor(next)))
                  }}
                />
                <div className="text-muted-foreground text-xs">
                  {importSplitMode === 'size'
                    ? "Used when splitting by file size; parts may exceed this target if a clean split point isn't available."
                    : 'Used only as a fallback if a single heading section exceeds the per-document limit.'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-4 items-center gap-4 mt-2">
              <div className="col-start-2 col-span-3">
                <Label className="flex items-center gap-3 font-normal cursor-pointer text-sm">
                  <Switch
                    checked={importIncludeContents}
                    onCheckedChange={(checked: boolean) => onImportIncludeContentsChange(checked)}
                  />
                  <span>Create table of contents doc</span>
                </Label>
              </div>
            </div>

            <div className="grid grid-cols-4 items-center gap-4 mt-2">
              <div className="col-start-2 col-span-3 space-y-1">
                <Label className="flex items-center gap-3 font-normal cursor-pointer text-sm">
                  <Switch
                    checked={importRawHtmlMode === 'code_block'}
                    onCheckedChange={(checked: boolean) =>
                      onImportRawHtmlModeChange(checked ? 'code_block' : 'drop')
                    }
                  />
                  <span>Preserve raw HTML as code</span>
                </Label>
                <div className="text-muted-foreground text-xs">
                  When disabled, raw HTML tags are stripped and unsupported structure is not
                  preserved.
                </div>
              </div>
            </div>

            {importProgress.total > 0 ? (
              <div className="text-muted-foreground text-sm">
                {importProgress.isRunning ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Importing {importProgress.imported}/{importProgress.total}
                    {importProgress.failed > 0 ? ` (${importProgress.failed} failed)` : ''}
                  </span>
                ) : (
                  <span>
                    Imported {importProgress.imported}/{importProgress.total}
                    {importProgress.failed > 0 ? ` (${importProgress.failed} failed)` : ''}
                  </span>
                )}
              </div>
            ) : null}
          </div>

          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => {
                if (importProgress.isRunning) {
                  onCancelImportDraft()
                } else {
                  onImportDialogOpenChange(false)
                }
              }}
            >
              {importProgress.isRunning ? 'Stop' : 'Cancel'}
            </Button>
            <Button onClick={onConfirmImportDraft} disabled={isBusy || importProgress.isRunning}>
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createDocumentOpen} onOpenChange={onCreateDocumentOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create document</DialogTitle>
            <DialogDescription>
              Create a document in {currentPath ? `/${currentPath}` : '/'}.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onCreateDocument()
            }}
          >
            <Input
              autoFocus
              autoComplete="off"
              value={newDocumentName}
              onChange={(event) => onNewDocumentNameChange(event.target.value)}
              placeholder="chapter-01.md"
            />
            <DialogFooter className="mt-4">
              <DialogClose render={<Button variant="outline">Cancel</Button>} />
              <Button type="submit" disabled={!newDocumentName.trim() || isBusy}>
                {isCreatingDocument ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={createDirectoryOpen} onOpenChange={onCreateDirectoryOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create directory</DialogTitle>
            <DialogDescription>
              Create a directory in {currentPath ? `/${currentPath}` : '/'}.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onCreateDirectory()
            }}
          >
            <Input
              autoFocus
              autoComplete="off"
              value={newDirectoryName}
              onChange={(event) => onNewDirectoryNameChange(event.target.value)}
              placeholder="chapter-01"
            />
            <DialogFooter className="mt-4">
              <DialogClose render={<Button variant="outline">Cancel</Button>} />
              <Button type="submit" disabled={!newDirectoryName.trim() || isBusy}>
                {isCreatingDirectory ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => !open && onRenameTargetChange(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {renameTarget?.type === 'directory' ? 'Rename directory' : 'Rename document'}
            </DialogTitle>
            <DialogDescription>{renameDescription}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onRename()
            }}
          >
            <Input
              autoFocus
              autoComplete="off"
              value={renameName}
              onChange={(event) => onRenameNameChange(event.target.value)}
              placeholder="new-name"
            />
            <DialogFooter className="mt-4">
              <DialogClose render={<Button variant="outline">Cancel</Button>} />
              <Button type="submit" disabled={!renameName.trim() || isBusy}>
                {isRenaming ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={moveTarget !== null} onOpenChange={(open) => !open && onMoveTargetChange(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {moveTarget?.type === 'directory' ? 'Move directory' : 'Move document'}
            </DialogTitle>
            <DialogDescription>
              Enter destination directory path. Leave empty to move to root.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onMove()
            }}
          >
            <Input
              autoFocus
              autoComplete="off"
              value={moveDestination}
              onChange={(event) => onMoveDestinationChange(event.target.value)}
              placeholder="destination/path"
            />
            <DialogFooter className="mt-4">
              <DialogClose render={<Button variant="outline">Cancel</Button>} />
              <Button type="submit" disabled={isBusy}>
                {isMoving ? 'Moving...' : 'Move'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={documentSettingsOpen} onOpenChange={onDocumentSettingsOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Document settings</DialogTitle>
            <DialogDescription>
              Configure how {documentSettingsTitle || 'this document'} is indexed, which AI model it
              uses, and which embedding model indexes it for search.
            </DialogDescription>
          </DialogHeader>

          {isLoadingDocumentAiModel ||
          isLoadingDocumentEmbeddingModel ||
          isLoadingDocumentSettings ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm py-4">
              <Loader2 className="size-4 animate-spin" />
              Loading document settings…
            </div>
          ) : (
            <div className="space-y-8">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">AI model</h3>
                {documentAiModelResolvedId && documentAiModelResolvedScopeType ? (
                  <AiModelSelectionForm
                    allowInherit
                    compact
                    directSelection={documentAiModelDirectId}
                    resolvedProviderConfigId={documentAiModelResolvedId}
                    resolvedScopeType={documentAiModelResolvedScopeType}
                    availableProviders={availableProviders}
                    isSaving={isSavingDocumentAiModel}
                    saveLabel="Save document override"
                    onSave={onSaveDocumentAiModel}
                    modeLabel="AI model mode"
                  />
                ) : (
                  <div className="text-muted-foreground text-sm">
                    Unable to load AI model settings.
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Embedding model</h3>
                <p className="text-muted-foreground text-sm">
                  Shared documents inherit only document overrides or the global default for search
                  indexing.
                </p>
                {documentEmbeddingModelResolvedId && documentEmbeddingModelResolvedScopeType ? (
                  <AiModelSelectionForm
                    allowInherit
                    compact
                    directSelection={documentEmbeddingModelDirectId}
                    resolvedProviderConfigId={documentEmbeddingModelResolvedId}
                    resolvedScopeType={documentEmbeddingModelResolvedScopeType}
                    availableProviders={availableEmbeddingProviders}
                    isSaving={isSavingDocumentEmbeddingModel}
                    saveLabel="Save document override"
                    onSave={onSaveDocumentEmbeddingModel}
                    modeLabel="Embedding model mode"
                  />
                ) : (
                  <div className="text-muted-foreground text-sm">
                    Unable to load embedding model settings.
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Indexing strategy</h3>
                <p className="text-muted-foreground text-sm">
                  Shared documents inherit only document overrides or the global default for
                  chunking.
                </p>
                {documentSettingsResolvedStrategy && documentSettingsResolvedScopeType ? (
                  <IndexingStrategyForm
                    allowInherit
                    compact
                    directStrategy={documentSettingsDirectStrategy}
                    resolvedStrategy={documentSettingsResolvedStrategy}
                    resolvedScopeType={documentSettingsResolvedScopeType}
                    isSaving={isSavingDocumentSettings}
                    saveLabel="Save document override"
                    onSave={onSaveDocumentSettings}
                    modeLabel="Indexing mode"
                  />
                ) : (
                  <div className="text-muted-foreground text-sm">
                    Unable to load indexing settings.
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && onDeleteTargetChange(null)}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.type === 'directory' ? 'Delete directory?' : 'Delete document?'}
            </AlertDialogTitle>
            <AlertDialogDescription>{deleteDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDelete}>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
