import { useState } from 'react'
import { useNavigate } from 'react-router'
import { trpc } from '@/lib/trpc'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Plus,
  Trash2,
  BookOpen,
  SlidersHorizontal,
  MessagesSquare,
  Users,
  LogOut,
  ChevronDown,
} from 'lucide-react'
import { parseProjectsListSyncEvent } from '@/lib/project-sync-events'

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function UserMenu({
  name,
  email,
  onLogout,
  isPending,
}: {
  name: string
  email: string
  onLogout: () => void
  isPending: boolean
}) {
  const initials = getInitials(name)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="sm:size-auto sm:px-2.5 sm:py-2 gap-1.5"
            aria-label="Account menu"
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-semibold leading-none">
              {initials || '?'}
            </span>
            <ChevronDown className="size-3 text-muted-foreground hidden sm:block" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5 py-2.5">
            <span className="text-sm font-medium text-foreground">{name}</span>
            <span className="text-xs text-muted-foreground font-normal">{email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={isPending} onClick={onLogout}>
          <LogOut />
          {isPending ? 'Logging out…' : 'Log out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function HomePage() {
  const navigate = useNavigate()
  const [newTitle, setNewTitle] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; title: string } | null>(null)
  const utils = trpc.useUtils()
  const configQuery = trpc.config.get.useQuery()
  const authEnabled = Boolean(configQuery.data?.fields.authEnabled.effectiveValue)
  const meQuery = trpc.auth.me.useQuery(undefined, { enabled: authEnabled })
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      window.location.href = '/login'
    },
    onError: (error) => {
      toast.error('Failed to logout', { description: error.message })
    },
  })

  const projectsQuery = trpc.projects.list.useQuery()
  trpc.sync.onProjectsListEvent.useSubscription(undefined, {
    onData: (event) => {
      if (!parseProjectsListSyncEvent(event)) return
      utils.projects.list.invalidate()
    },
  })

  const createMutation = trpc.projects.create.useMutation({
    onSuccess: (project) => {
      utils.projects.get.setData({ id: project.id }, project)
      setNewTitle('')
      setDialogOpen(false)
      navigate(`/project/${project.id}`)
    },
  })
  const deleteMutation = trpc.projects.delete.useMutation({
    onSuccess: () => {
      setProjectToDelete(null)
      utils.projects.list.invalidate()
    },
  })

  const handleCreate = () => {
    if (!newTitle.trim()) return
    createMutation.mutate({ title: newTitle.trim() })
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-12">
        <div className="mb-8 sm:mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Plotline</h1>
            <p className="text-muted-foreground mt-1 text-sm sm:text-base">
              Your stories, your way.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="sm:size-auto sm:px-3 sm:py-2"
              onClick={() => navigate('/admin/config')}
            >
              <SlidersHorizontal data-icon="inline-start" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="sm:size-auto sm:px-3 sm:py-2"
              onClick={() => navigate('/admin/prompts')}
            >
              <MessagesSquare data-icon="inline-start" />
              <span className="hidden sm:inline">Prompts</span>
            </Button>
            {authEnabled ? (
              <Button
                variant="outline"
                size="sm"
                className="sm:size-auto sm:px-3 sm:py-2"
                onClick={() => navigate('/admin/users')}
              >
                <Users data-icon="inline-start" />
                <span className="hidden sm:inline">Users</span>
              </Button>
            ) : null}
            {authEnabled ? (
              <UserMenu
                name={meQuery.data?.name ?? ''}
                email={meQuery.data?.email ?? ''}
                onLogout={() => logoutMutation.mutate()}
                isPending={logoutMutation.isPending}
              />
            ) : null}

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger
                render={
                  <Button size="sm" className="sm:size-auto sm:px-3 sm:py-2">
                    <Plus data-icon="inline-start" />
                    New Project
                  </Button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New Project</DialogTitle>
                  <DialogDescription>
                    Give your story a working title; you can change it later.
                  </DialogDescription>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleCreate()
                  }}
                >
                  <Input
                    autoFocus
                    autoComplete="off"
                    placeholder="The Great Novel..."
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                  />
                  <DialogFooter className="mt-4">
                    <DialogClose render={<Button variant="outline">Cancel</Button>} />
                    <Button type="submit" disabled={!newTitle.trim() || createMutation.isPending}>
                      {createMutation.isPending ? 'Creating...' : 'Create'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {projectsQuery.isLoading && <p className="text-muted-foreground">Loading projects...</p>}

        {projectsQuery.data?.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-24 text-center">
            <BookOpen className="text-muted-foreground size-12" />
            <div>
              <p className="text-lg font-medium">No projects yet</p>
              <p className="text-muted-foreground text-sm">
                Create your first project to start writing.
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projectsQuery.data?.map((project) => (
            <Card
              key={project.id}
              className="cursor-pointer transition-shadow hover:shadow-lg"
              onClick={() => navigate(`/project/${project.id}`)}
            >
              <CardHeader>
                <CardTitle className="truncate">{project.title}</CardTitle>
                <CardDescription>
                  Updated{' '}
                  {new Date(project.updatedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </CardDescription>
              </CardHeader>
              <CardFooter className="justify-end">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    setProjectToDelete(project)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>

        <AlertDialog
          open={projectToDelete !== null}
          onOpenChange={(open) => !open && setProjectToDelete(null)}
        >
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete project?</AlertDialogTitle>
              <AlertDialogDescription>
                "{projectToDelete?.title}" will be permanently deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteMutation.mutate({ id: projectToDelete!.id })}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
