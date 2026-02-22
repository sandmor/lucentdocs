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
import type { DeleteTarget, MoveTarget, RenameTarget } from './types'

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
}: BrowserDialogsProps) {
  return (
    <>
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
