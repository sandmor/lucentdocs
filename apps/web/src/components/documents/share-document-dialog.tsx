import { useMemo, useState, type ReactElement } from 'react'
import { Crown, Share2, UserMinus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { trpc } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Role = 'viewer' | 'editor'

export function ShareDocumentDialog({
  documentId,
  trigger,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  documentId: string
  trigger?: ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = onOpenChange ?? setUncontrolledOpen
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const access = trpc.documents.accessRole.useQuery({ documentId }, { enabled: open })
  const collaborators = trpc.documents.collaborators.useQuery(
    { documentId },
    { enabled: open && access.data?.role === 'owner' }
  )
  const canManage = access.data?.role === 'owner'
  const utils = trpc.useUtils()
  const leave = trpc.documents.leaveShare.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.documents.list.invalidate(), utils.documents.accessRole.invalidate({ documentId })])
      setOpen(false)
      toast.success('You no longer have access to this document')
    },
    onError: (error) => toast.error('Could not leave document', { description: error.message }),
  })
  const invite = trpc.documents.invite.useMutation({
    onSuccess: async () => {
      setEmail('')
      await collaborators.refetch()
      toast.success('Invitation sent')
    },
    onError: (error) => toast.error('Could not share document', { description: error.message }),
  })
  const changeRole = trpc.documents.changeCollaboratorRole.useMutation({
    onSuccess: () => void collaborators.refetch(),
    onError: (error) => toast.error('Could not change access', { description: error.message }),
  })
  const revoke = trpc.documents.revokeCollaborator.useMutation({
    onSuccess: async () => {
      await collaborators.refetch()
      await utils.documents.accessRole.invalidate({ documentId })
      toast.success('Access revoked')
    },
    onError: (error) => toast.error('Could not revoke access', { description: error.message }),
  })
  const rows = useMemo(() => collaborators.data ?? [], [collaborators.data])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && <DialogTrigger render={trigger ?? <Button variant="outline" size="sm"><Share2 data-icon="inline-start" />Share</Button>} />}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-serif">Share this document</DialogTitle>
          <DialogDescription>
            Content, notes and history travel with the document. Each collaborator chooses where it appears in their own project.
          </DialogDescription>
        </DialogHeader>

        {!canManage ? (
          <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
            <p>You have <span className="font-medium text-foreground">{access.data?.role === 'viewer' ? 'view-only' : 'editor'}</span> access. The home-project owner manages collaborators.</p>
            <Button className="mt-3" variant="outline" size="sm" disabled={leave.isPending} onClick={() => leave.mutate({ documentId })}>{leave.isPending ? 'Leaving…' : 'Leave document'}</Button>
          </div>
        ) : (
          <div className="space-y-5">
            <section className="rounded-xl border bg-muted/20 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium"><Share2 className="size-4" />Invite a collaborator</div>
              <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                <Field>
                  <FieldLabel htmlFor="share-email">Registered email</FieldLabel>
                  <Input id="share-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="writer@example.com" />
                </Field>
                <Field>
                  <FieldLabel>Access</FieldLabel>
                  <Select value={role} onValueChange={(value) => setRole(value as Role)}>
                    <SelectTrigger><SelectValue>{role === 'editor' ? 'Can edit' : 'View only'}</SelectValue></SelectTrigger>
                    <SelectContent><SelectItem value="editor">Can edit</SelectItem><SelectItem value="viewer">View only</SelectItem></SelectContent>
                  </Select>
                </Field>
              </div>
              <Button className="mt-3" disabled={!email.trim() || invite.isPending} onClick={() => invite.mutate({ documentId, recipientEmail: email.trim(), role })}>
                {invite.isPending ? 'Sending…' : 'Send invitation'}
              </Button>
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Users className="size-4" />Collaborators</div>
              {rows.length === 0 ? <p className="rounded-lg border border-dashed px-3 py-5 text-sm text-muted-foreground">No collaborators yet.</p> : (
                <div className="overflow-hidden rounded-xl border">
                  {rows.map((collaborator) => (
                    <div key={collaborator.userId} className="flex items-center gap-3 border-b px-3 py-3 last:border-b-0">
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{collaborator.name}</p><p className="truncate text-xs text-muted-foreground">{collaborator.email ?? collaborator.userId}</p></div>
                      <Select value={collaborator.role} onValueChange={(value) => changeRole.mutate({ documentId, userId: collaborator.userId, role: value as Role })}>
                        <SelectTrigger className="w-28"><SelectValue>{collaborator.role === 'editor' ? 'Can edit' : 'View only'}</SelectValue></SelectTrigger>
                        <SelectContent><SelectItem value="editor">Can edit</SelectItem><SelectItem value="viewer">View only</SelectItem></SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon-sm" aria-label={`Revoke ${collaborator.name}`} disabled={revoke.isPending} onClick={() => revoke.mutate({ documentId, userId: collaborator.userId })}><UserMinus className="size-4 text-destructive" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
        {canManage && <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground"><Crown className="size-3.5" />You own this document through its home project.</div>}
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
