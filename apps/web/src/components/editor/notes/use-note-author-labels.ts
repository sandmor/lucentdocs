import { useMemo } from 'react'
import { trpc } from '@/lib/trpc'

const PRESENCE_COLORS = [
  '#2563eb',
  '#dc2626',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#db2777',
  '#0891b2',
  '#65a30d',
  '#4f46e5',
  '#c2410c',
] as const

export function userIdToPresenceColor(userId: string): string {
  let hash = 0
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash + userId.charCodeAt(index)) % PRESENCE_COLORS.length
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length]
}

export function useNoteAuthorLabels(
  authorUserIds: string[],
  currentUserId: string | null | undefined,
  projectId?: string
) {
  const uniqueIds = useMemo(
    () => [...new Set(authorUserIds.filter((id) => id.length > 0))],
    [authorUserIds]
  )

  const unresolvedIds = useMemo(
    () => uniqueIds.filter((id) => id !== currentUserId),
    [uniqueIds, currentUserId]
  )

  const resolveQuery = trpc.auth.resolveUsers.useQuery(
    { userIds: unresolvedIds, projectId },
    { enabled: unresolvedIds.length > 0 }
  )

  const nameById = useMemo(() => {
    const map = new Map<string, string>()
    if (currentUserId) {
      map.set(currentUserId, 'You')
    }
    for (const user of resolveQuery.data ?? []) {
      map.set(user.id, user.name)
    }
    return map
  }, [currentUserId, resolveQuery.data])

  return useMemo(
    () => ({
      getLabel(userId: string) {
        if (userId === currentUserId) return 'You'
        return nameById.get(userId) ?? 'Unknown user'
      },
      getColor(userId: string) {
        return userIdToPresenceColor(userId)
      },
    }),
    [currentUserId, nameById]
  )
}
