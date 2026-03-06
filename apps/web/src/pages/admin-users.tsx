import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeft, Copy, Trash2, UserRoundPlus } from 'lucide-react'
import { toast } from 'sonner'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

function formatDate(timestamp: number | null): string {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleString()
}

export function AdminUsersPage() {
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const [email, setEmail] = useState('')
  const [expiresInDays, setExpiresInDays] = useState('7')
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null)
  const [nowTs, setNowTs] = useState(() => Date.now())

  const configQuery = trpc.config.get.useQuery()
  const authEnabled = Boolean(configQuery.data?.fields.authEnabled.effectiveValue)

  useEffect(() => {
    if (configQuery.isLoading) return
    if (authEnabled) return
    navigate('/', { replace: true })
  }, [authEnabled, configQuery.isLoading, navigate])

  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: authEnabled,
  })
  const usersQuery = trpc.auth.listUsers.useQuery(undefined, {
    enabled: authEnabled,
  })
  const invitationsQuery = trpc.auth.listInvitations.useQuery(undefined, {
    enabled: authEnabled,
  })

  const createInvitationMutation = trpc.auth.createInvitation.useMutation({
    onSuccess: async (invitation) => {
      const absoluteUrl = `${window.location.origin}${invitation.inviteUrl}`
      setLastInviteUrl(absoluteUrl)
      await utils.auth.listInvitations.invalidate()
      toast.success('Invitation created')
    },
    onError: (error) => {
      toast.error('Failed to create invitation', { description: error.message })
    },
  })

  const revokeInvitationMutation = trpc.auth.revokeInvitation.useMutation({
    onSuccess: async () => {
      await utils.auth.listInvitations.invalidate()
      toast.success('Invitation revoked')
    },
    onError: (error) => {
      toast.error('Failed to revoke invitation', { description: error.message })
    },
  })

  const deleteUserMutation = trpc.auth.deleteUser.useMutation({
    onSuccess: async () => {
      await utils.auth.listUsers.invalidate()
      toast.success('User deleted')
    },
    onError: (error) => {
      toast.error('Failed to delete user', { description: error.message })
    },
  })

  const sortedInvitations = useMemo(() => {
    return [...(invitationsQuery.data ?? [])].sort(
      (left, right) => right.createdAt - left.createdAt
    )
  }, [invitationsQuery.data])

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTs(Date.now())
    }, 30_000)
    return () => {
      clearInterval(timer)
    }
  }, [])

  const handleCreateInvitation = () => {
    const parsedDays = Number.parseInt(expiresInDays, 10)
    if (!Number.isFinite(parsedDays) || parsedDays < 1) {
      toast.error('Expiration days must be at least 1')
      return
    }

    createInvitationMutation.mutate({
      email: email.trim() || undefined,
      expiresInDays: parsedDays,
      role: 'user',
    })
  }

  const copyInviteUrl = async (value: string) => {
    await navigator.clipboard.writeText(value)
    toast.success('Invitation link copied')
  }

  if (configQuery.isLoading || !authEnabled) return null

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-10 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Users & Invitations</h1>
            <p className="text-muted-foreground mt-1 text-sm sm:text-base">
              Manage members and invite links for signup.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate('/')}>
              <ArrowLeft data-icon="inline-start" />
              Back
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Create invitation link</CardTitle>
            <CardDescription>
              Create a one-time signup link. Email can be restricted or left open.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="invite-email">Email (optional)</FieldLabel>
              <Input
                id="invite-email"
                placeholder="user@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="invite-days">Expires in days</FieldLabel>
              <Input
                id="invite-days"
                type="number"
                min={1}
                max={365}
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
              />
            </Field>
            <div className="flex items-end">
              <Button
                className="w-full"
                disabled={createInvitationMutation.isPending}
                onClick={handleCreateInvitation}
              >
                <UserRoundPlus data-icon="inline-start" />
                {createInvitationMutation.isPending ? 'Creating...' : 'Create invitation'}
              </Button>
            </div>

            {lastInviteUrl ? (
              <div className="sm:col-span-3 flex flex-col gap-2 rounded-md border p-3">
                <div className="text-sm font-medium">Latest invitation link</div>
                <div className="text-sm text-muted-foreground break-all">{lastInviteUrl}</div>
                <div>
                  <Button variant="outline" size="sm" onClick={() => copyInviteUrl(lastInviteUrl)}>
                    <Copy data-icon="inline-start" />
                    Copy link
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(usersQuery.data ?? []).map((user) => {
                  const isSelf = user.id === meQuery.data?.id
                  return (
                    <TableRow key={user.id}>
                      <TableCell>{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{user.role}</Badge>
                      </TableCell>
                      <TableCell>{formatDate(user.lastLoginAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={isSelf || deleteUserMutation.isPending}
                          onClick={() => deleteUserMutation.mutate({ userId: user.id })}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invitations</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email restriction</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedInvitations.map((invitation) => {
                  const isExpired = invitation.expiresAt <= nowTs
                  const isUsed = invitation.usedAt !== null
                  const isRevoked = invitation.revokedAt !== null
                  const canRevoke = !isUsed && !isRevoked && !isExpired

                  const statusLabel = isUsed
                    ? 'Used'
                    : isRevoked
                      ? 'Revoked'
                      : isExpired
                        ? 'Expired'
                        : 'Active'

                  return (
                    <TableRow key={invitation.id}>
                      <TableCell>{invitation.email ?? 'Any email'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{statusLabel}</Badge>
                      </TableCell>
                      <TableCell>{formatDate(invitation.createdAt)}</TableCell>
                      <TableCell>{formatDate(invitation.expiresAt)}</TableCell>
                      <TableCell className="text-right">
                        {canRevoke ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={revokeInvitationMutation.isPending}
                            onClick={() => revokeInvitationMutation.mutate({ id: invitation.id })}
                          >
                            Revoke
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
