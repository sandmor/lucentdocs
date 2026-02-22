import { useState } from 'react'
import { useNavigate } from 'react-router'
import { trpc } from '@/lib/trpc'
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
import { Plus, Trash2, BookOpen, SlidersHorizontal } from 'lucide-react'

export function HomePage() {
  const navigate = useNavigate()
  const [newTitle, setNewTitle] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; title: string } | null>(null)

  const projectsQuery = trpc.projects.list.useQuery()
  const createMutation = trpc.projects.create.useMutation({
    onSuccess: (project) => {
      setNewTitle('')
      setDialogOpen(false)
      navigate(`/project/${project.id}`)
    },
  })
  const deleteMutation = trpc.projects.delete.useMutation({
    onSuccess: () => {
      setProjectToDelete(null)
      projectsQuery.refetch()
    },
  })

  const handleCreate = () => {
    if (!newTitle.trim()) return
    createMutation.mutate({ title: newTitle.trim() })
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <div className="mb-10 flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Plotline</h1>
            <p className="text-muted-foreground mt-1">Your stories, your way.</p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="lg" onClick={() => navigate('/admin/config')}>
              <SlidersHorizontal data-icon="inline-start" />
              Settings
            </Button>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger
                render={
                  <Button size="lg">
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
