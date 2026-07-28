import { useEffect, useState } from 'react'
import { Bell, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function ShareInvitations() {
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState('')
  const [path, setPath] = useState('')
  const utils = trpc.useUtils()
  const invitations = trpc.documents.shareInvitations.useQuery(undefined, { refetchInterval: 30_000 })
  const projects = trpc.projects.list.useQuery(undefined, { enabled: open })
  const selected = invitations.data?.find((invitation) => invitation.id === selectedId) ?? null
  const selectedProject = projects.data?.find((project) => project.id === projectId) ?? null
  useEffect(() => {
    if (selected && !path) setPath(selected.documentTitle)
  }, [path, selected])
  const accept = trpc.documents.acceptShare.useMutation({
    onSuccess: async () => {
      toast.success('Document added to your project')
      setOpen(false)
      setSelectedId(null); setPath(''); setProjectId('')
      await Promise.all([utils.documents.shareInvitations.invalidate(), utils.documents.list.invalidate()])
    },
    onError: (error) => toast.error('Could not accept share', { description: error.message }),
  })
  const decline = trpc.documents.declineShare.useMutation({
    onSuccess: () => { toast.success('Invitation declined'); void utils.documents.shareInvitations.invalidate() },
    onError: (error) => toast.error('Could not decline invitation', { description: error.message }),
  })
  const count = invitations.data?.length ?? 0
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSelectedId(null) }}>
    <DialogTrigger render={<Button variant="outline" size="sm" className="relative" aria-label="Document invitations"><Bell data-icon="inline-start" />Invitations{count ? <Badge className="ml-1 min-w-5 justify-center px-1">{count}</Badge> : null}</Button>} />
    <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle className="font-serif">Document invitations</DialogTitle><DialogDescription>Accepting adds the document to one of your projects. Its content stays shared; its path is yours.</DialogDescription></DialogHeader>
      {!selected ? <div className="space-y-2">{count === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No pending invitations.</p> : invitations.data?.map((invitation) => <div key={invitation.id} className="rounded-lg border p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{invitation.documentTitle}</p><p className="mt-1 text-sm text-muted-foreground">From {invitation.inviterName}</p><Badge variant="secondary" className="mt-2 capitalize">{invitation.role}</Badge></div><div className="flex gap-1"><Button size="icon-sm" aria-label="Accept invitation" onClick={() => setSelectedId(invitation.id)}><Check className="size-4" /></Button><Button size="icon-sm" variant="ghost" aria-label="Decline invitation" onClick={() => decline.mutate({ invitationId: invitation.id })}><X className="size-4" /></Button></div></div></div>)}</div> : <><Field><FieldLabel>Destination project</FieldLabel><Select value={projectId} onValueChange={(value) => setProjectId(value ?? '')}><SelectTrigger>{selectedProject ? <SelectValue>{selectedProject.title}</SelectValue> : <SelectValue placeholder="Choose a project" />}</SelectTrigger><SelectContent>{projects.data?.map((project) => <SelectItem key={project.id} value={project.id}>{project.title}</SelectItem>)}</SelectContent></Select></Field><Field className="mt-3"><FieldLabel htmlFor="share-mount-path">File path in that project</FieldLabel><Input id="share-mount-path" value={path} onChange={(event) => setPath(event.target.value)} /></Field><DialogFooter className="mt-5"><Button variant="outline" onClick={() => setSelectedId(null)}>Back</Button><Button disabled={!projectId || !path.trim() || accept.isPending} onClick={() => accept.mutate({ invitationId: selected.id, projectId, path: path.trim() })}>{accept.isPending ? 'Adding…' : 'Add to project'}</Button></DialogFooter></>}
    </DialogContent>
  </Dialog>
}
