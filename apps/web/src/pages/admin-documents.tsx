import { useMemo, useState } from 'react'
import { ArrowLeft, FileText, Search } from 'lucide-react'
import { useNavigate } from 'react-router'
import { trpc } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageLoader } from '@/components/ui/page-loader'

export function AdminDocumentsPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const me = trpc.auth.me.useQuery()
  const inventory = trpc.documents.adminInventory.useQuery(undefined, {
    enabled: me.data?.role === 'admin',
  })
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return inventory.data ?? []
    return (inventory.data ?? []).filter((row) =>
      [row.document.title, row.homeProject?.title, row.owner?.name, row.owner?.email]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle))
    )
  }, [inventory.data, query])

  if (me.isLoading || inventory.isLoading) return <PageLoader message="Loading documents…" />
  if (me.data?.role !== 'admin') return null

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Administration
            </p>
            <h1 className="font-serif text-3xl font-bold tracking-tight">Documents</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Canonical documents, their home projects and collaboration footprint.
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate('/')}>
            <ArrowLeft data-icon="inline-start" />
            Back
          </Button>
        </div>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Document inventory</CardTitle>
            <CardDescription>
              Ownership is derived from the document’s home project.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative mb-4 max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search documents, projects or owners"
              />
            </div>
            <div className="overflow-hidden rounded-xl border">
              {rows.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No matching documents.
                </div>
              ) : (
                rows.map((row) => (
                  <button
                    key={row.document.id}
                    type="button"
                    className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/40"
                    onClick={() => navigate(`/project/${row.document.homeProjectId}`)}
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <FileText className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.document.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.homeProject?.title ?? 'Missing home project'} ·{' '}
                        {row.owner?.name ?? 'Unknown owner'}
                      </p>
                    </div>
                    <div className="hidden text-right text-xs text-muted-foreground sm:block">
                      <p>
                        {row.collaboratorCount} collaborator{row.collaboratorCount === 1 ? '' : 's'}
                      </p>
                      <p>{new Date(row.document.updatedAt).toLocaleDateString()}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
