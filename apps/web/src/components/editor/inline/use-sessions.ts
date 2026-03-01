import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { InlineZoneSession } from '@plotline/shared'
import type { AIWriterState } from '../ai/writer-plugin'
import { trpc } from '@/lib/trpc'

interface UseInlineSessionsOptions {
  projectId?: string
  documentId: string
  aiState: AIWriterState | null
}

interface UseInlineSessionsResult {
  inlineSessionsById: Record<string, InlineZoneSession>
  inlineSessionsRef: MutableRefObject<Record<string, InlineZoneSession>>
  setInlineSessionsById: Dispatch<SetStateAction<Record<string, InlineZoneSession>>>
}

export function useInlineSessions({
  projectId,
  documentId,
  aiState,
}: UseInlineSessionsOptions): UseInlineSessionsResult {
  const [inlineSessionsById, setInlineSessionsById] = useState<Record<string, InlineZoneSession>>(
    {}
  )
  const inlineSessionsRef = useRef<Record<string, InlineZoneSession>>({})

  const inlineSessionIds = useMemo(() => {
    if (!aiState) return []

    const sessionIds = new Set<string>()
    for (const zone of aiState.zones) {
      if (!zone.sessionId) continue
      sessionIds.add(zone.sessionId)
    }
    return [...sessionIds].sort((left, right) => left.localeCompare(right))
  }, [aiState])

  const inlineSessionsQuery = trpc.inline.getSessions.useQuery(
    {
      projectId: projectId ?? '',
      documentId,
      sessionIds: inlineSessionIds,
    },
    {
      enabled: Boolean(projectId && documentId && inlineSessionIds.length > 0),
      refetchOnWindowFocus: false,
    }
  )

  useEffect(() => {
    if (!inlineSessionsQuery.data) return
    setInlineSessionsById((previous) => {
      const next = {
        ...previous,
        ...inlineSessionsQuery.data.sessions,
      }
      inlineSessionsRef.current = next
      return next
    })
  }, [inlineSessionsQuery.data])

  return {
    inlineSessionsById,
    inlineSessionsRef,
    setInlineSessionsById,
  }
}
